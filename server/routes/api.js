import { Router } from 'express';
import { getDB } from '../lib/db.js';
import { getLatestSnapshotsAll } from '../lib/dao.js';

const router = Router();

// API endpoint for dashboard data
router.get('/api/dashboard', (req, res) => {
  try {
    const db = getDB();

    // Get recent learning activity
    const recentActivity = db.prepare(`
      SELECT type, payload, ts
      FROM events
      WHERE type IN ('chat_interaction', 'concept_detection')
      ORDER BY ts DESC
      LIMIT 20
    `).all();

    // Get learning progress summary
    const progressSummary = db.prepare(`
      SELECT
        COUNT(*) as total_concepts,
        COUNT(CASE WHEN mastery = 'known' THEN 1 END) as known_concepts,
        COUNT(CASE WHEN mastery = 'learning' THEN 1 END) as learning_concepts
      FROM progress p
      JOIN concepts c ON c.id = p.concept_id
      WHERE c.source_graph = 'personal'
    `).get();

    res.json({
      ok: true,
      activity: recentActivity,
      progress: progressSummary,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// API endpoint for learning history and conversation analysis
router.get('/api/conversations/summary', (req, res) => {
  try {
    const { topic, limit = 20 } = req.query;
    const db = getDB();

    // Get conversation history with concept detection
    let query = `
      SELECT
        json_extract(payload, '$.role') as role,
        json_extract(payload, '$.text') as text,
        json_extract(payload, '$.topicHint') as topic_hint,
        json_extract(payload, '$.conceptsDetected') as concepts_detected,
        json_extract(payload, '$.processingNote') as processing_note,
        ts,
        date(ts) as conversation_date
      FROM events
      WHERE type = 'chat_interaction'
    `;

    const params = [];
    if (topic) {
      query += ` AND (json_extract(payload, '$.topicHint') LIKE ? OR json_extract(payload, '$.text') LIKE ?)`;
      params.push(`%${topic}%`, `%${topic}%`);
    }

    query += ` ORDER BY ts DESC LIMIT ?`;
    params.push(parseInt(limit));

    const conversations = db.prepare(query).all(...params);

    // Get concept mastery evolution over time
    const masteryEvolution = db.prepare(`
      SELECT
        c.label,
        c.norm_label,
        p.mastery,
        p.score,
        p.last_updated,
        date(p.last_updated) as mastery_date
      FROM concepts c
      JOIN progress p ON p.concept_id = c.id
      WHERE c.source_graph = 'personal'
        AND p.last_updated IS NOT NULL
      ORDER BY p.last_updated DESC
      LIMIT 50
    `).all();

    // Analyze learning progression by date
    const learningTimeline = {};
    const topicInsights = {};

    conversations.forEach(conv => {
      const date = conv.conversation_date;
      const topic = conv.topic_hint || 'general';
      const conceptsCount = parseInt(conv.concepts_detected || 0);

      // Build daily learning timeline
      if (!learningTimeline[date]) {
        learningTimeline[date] = {
          date,
          conversations: 0,
          conceptsDetected: 0,
          topics: new Set(),
          keyMoments: []
        };
      }

      learningTimeline[date].conversations++;
      learningTimeline[date].conceptsDetected += conceptsCount;
      learningTimeline[date].topics.add(topic);

      // Identify key learning moments (high concept detection)
      if (conceptsCount >= 3) {
        learningTimeline[date].keyMoments.push({
          role: conv.role,
          text: conv.text?.substring(0, 150) + '...',
          conceptsCount,
          timestamp: conv.ts
        });
      }

      // Build topic insights
      if (!topicInsights[topic]) {
        topicInsights[topic] = {
          topic,
          sessions: 0,
          totalConcepts: 0,
          firstSeen: conv.ts,
          lastSeen: conv.ts,
          learningPatterns: []
        };
      }

      topicInsights[topic].sessions++;
      topicInsights[topic].totalConcepts += conceptsCount;
      topicInsights[topic].firstSeen = conv.ts; // Will be overwritten by earlier dates due to DESC order
    });

    // Convert timeline to array and add topics as arrays
    const timelineArray = Object.values(learningTimeline).map(day => ({
      ...day,
      topics: Array.from(day.topics),
      learningIntensity: day.conceptsDetected / day.conversations // concepts per conversation
    })).sort((a, b) => new Date(b.date) - new Date(a.date));

    // Generate learning insights
    const insights = generateLearningHistoryInsights(timelineArray, Object.values(topicInsights), masteryEvolution);

    // Calculate learning statistics
    const totalConversations = conversations.length;
    const totalConceptsDetected = conversations.reduce((sum, conv) => sum + parseInt(conv.concepts_detected || 0), 0);
    const uniqueTopics = new Set(conversations.map(c => c.topic_hint || 'general')).size;
    const averageConceptsPerConversation = totalConversations > 0 ? totalConceptsDetected / totalConversations : 0;

    // Identify learning streaks
    const learningStreaks = identifyLearningStreaks(timelineArray);

    res.json({
      ok: true,
      learningHistory: {
        totalConversations,
        totalConceptsDetected,
        uniqueTopics,
        averageConceptsPerConversation: Math.round(averageConceptsPerConversation * 100) / 100,
        activeDays: timelineArray.length,
        longestStreak: learningStreaks.longest,
        currentStreak: learningStreaks.current
      },
      timeline: timelineArray.slice(0, 14), // Last 2 weeks
      topicInsights: Object.values(topicInsights).sort((a, b) => b.totalConcepts - a.totalConcepts),
      masteryEvolution: masteryEvolution.slice(0, 10), // Recent mastery changes
      insights,
      learningStreaks
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Helper function to generate learning history insights
function generateLearningHistoryInsights(timeline, topicInsights, masteryEvolution) {
  const insights = [];

  // Check for recent learning activity
  const recentDays = timeline.slice(0, 3);
  const recentActivity = recentDays.reduce((sum, day) => sum + day.conceptsDetected, 0);

  if (recentActivity > 10) {
    insights.push({
      type: 'positive',
      title: 'High Learning Activity',
      message: `You've been actively learning with ${recentActivity} concepts detected in the last 3 days.`,
      action: 'Keep up the momentum! Consider reviewing what you\'ve learned.'
    });
  } else if (recentActivity === 0) {
    insights.push({
      type: 'suggestion',
      title: 'Learning Opportunity',
      message: 'No recent learning activity detected.',
      action: 'Consider starting a conversation about a topic you want to learn more about.'
    });
  }

  // Analyze learning patterns
  if (timeline.length >= 7) {
    const weekdayActivity = timeline.reduce((acc, day) => {
      const dayOfWeek = new Date(day.date).getDay();
      acc[dayOfWeek] = (acc[dayOfWeek] || 0) + day.conceptsDetected;
      return acc;
    }, {});

    const mostActiveDay = Object.entries(weekdayActivity).reduce((max, [day, activity]) =>
      activity > max.activity ? { day: parseInt(day), activity } : max, { day: 0, activity: 0 });

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    insights.push({
      type: 'pattern',
      title: 'Learning Pattern',
      message: `You're most active learning on ${dayNames[mostActiveDay.day]}s.`,
      action: 'Consider scheduling important study sessions on your most productive days.'
    });
  }

  // Topic diversity analysis
  const topicCount = topicInsights.length;
  if (topicCount === 1) {
    insights.push({
      type: 'suggestion',
      title: 'Expand Your Learning',
      message: 'You\'ve been focused on one main topic.',
      action: 'Consider exploring related topics to broaden your understanding.'
    });
  } else if (topicCount >= 5) {
    insights.push({
      type: 'positive',
      title: 'Diverse Learning',
      message: `Great job exploring ${topicCount} different topics!`,
      action: 'Consider connecting concepts across different topics for deeper understanding.'
    });
  }

  return insights;
}

// Helper function to identify learning streaks
function identifyLearningStreaks(timeline) {
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  // Sort by date ascending to check consecutive days
  const sortedDays = timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

  for (let i = 0; i < sortedDays.length; i++) {
    const day = sortedDays[i];
    if (day.conceptsDetected > 0) {
      tempStreak++;
      if (i === sortedDays.length - 1) { // Last day in array (most recent)
        currentStreak = tempStreak;
      }
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 0;
      if (i === sortedDays.length - 1) {
        currentStreak = 0;
      }
    }
  }

  longestStreak = Math.max(longestStreak, tempStreak);

  return {
    current: currentStreak,
    longest: longestStreak
  };
}

// API endpoint for learning gaps and next steps
router.get('/api/learning-gaps', (req, res) => {
  try {
    const { topic } = req.query;
    const db = getDB();

    // Get all concepts from domain and syllabus graphs
    const allConcepts = db.prepare(`
      SELECT
        c.id,
        c.label,
        c.norm_label,
        c.source_graph,
        p.mastery,
        p.score,
        p.last_updated
      FROM concepts c
      LEFT JOIN progress p ON p.concept_id = c.id
      WHERE c.source_graph IN ('syllabus', 'domain')
      ${topic ? "AND c.norm_label LIKE ?" : ""}
      ORDER BY c.source_graph, p.score DESC NULLS LAST
    `).all(topic ? [`%${topic}%`] : []);

    // Get upcoming assignments for relevance mapping from actual course data
    const upcomingAssignmentsFromDB = db.prepare(`
      SELECT
        label,
        provenance,
        norm_label
      FROM concepts
      WHERE source_graph = 'syllabus'
      AND json_extract(provenance, '$.type') = 'assignment'
      AND json_extract(provenance, '$.due_at') IS NOT NULL
      ORDER BY json_extract(provenance, '$.due_at') ASC
      LIMIT 10
    `).all();

    const upcomingAssignments = upcomingAssignmentsFromDB.map(assignment => {
      try {
        const provenance = JSON.parse(assignment.provenance || '{}');
        return {
          id: provenance.id || assignment.label,
          title: assignment.label.replace('Assignment: ', ''),
          dueDate: provenance.due_at,
          relatedConcepts: [assignment.norm_label] // Use the normalized concept as related
        };
      } catch {
        return {
          id: assignment.label,
          title: assignment.label,
          dueDate: null,
          relatedConcepts: [assignment.norm_label]
        };
      }
    });

    // Fallback to sample data if no real assignments found
    if (upcomingAssignments.length === 0) {
      upcomingAssignments.push(
        {
          id: 'assignment_1',
          title: 'Machine Learning Fundamentals Quiz',
          dueDate: '2024-09-20T23:59:00Z',
          relatedConcepts: ['supervised learning', 'linear regression', 'classification']
        },
        {
          id: 'assignment_2',
          title: 'Linear Regression Implementation',
          dueDate: '2024-09-25T23:59:00Z',
          relatedConcepts: ['linear regression', 'gradient descent', 'python programming']
        }
      );
    }

    // Identify learning gaps (concepts not yet mastered)
    const gaps = allConcepts
      .filter(concept => !concept.mastery || concept.mastery === 'learning')
      .map(concept => {
        // Find related assignments
        const relatedAssignments = upcomingAssignments.filter(assignment =>
          assignment.relatedConcepts.some(relConcept =>
            concept.norm_label.toLowerCase().includes(relConcept.toLowerCase()) ||
            relConcept.toLowerCase().includes(concept.norm_label.toLowerCase())
          )
        );

        // Generate AI-powered learning plan based on concept
        const learningPlan = generateLearningPlan(concept);

        // Determine priority based on assignment proximity and current progress
        const priority = calculatePriority(concept, relatedAssignments);

        return {
          concept: concept.label,
          source: concept.source_graph,
          currentStatus: concept.mastery || 'not_started',
          currentScore: concept.score || 0,
          priority,
          estimatedTime: learningPlan.estimatedTime,
          difficulty: learningPlan.difficulty,
          nextSteps: learningPlan.steps,
          learningPlan: learningPlan.description,
          relatedAssignments: relatedAssignments.map(a => ({
            title: a.title,
            dueDate: a.dueDate,
            urgency: getAssignmentUrgency(a.dueDate)
          })),
          recommendedAction: learningPlan.recommendedAction
        };
      })
      .sort((a, b) => {
        // Sort by priority: high > medium > low
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });

    // Generate overall learning insights
    const insights = generateLearningInsights(gaps, allConcepts);

    const gapStats = {
      totalGaps: gaps.length,
      highPriority: gaps.filter(g => g.priority === 'high').length,
      mediumPriority: gaps.filter(g => g.priority === 'medium').length,
      lowPriority: gaps.filter(g => g.priority === 'low').length,
      totalConcepts: allConcepts.length,
      masteredConcepts: allConcepts.filter(c => c.mastery === 'known').length,
      averageProgress: allConcepts.reduce((sum, c) => sum + (c.score || 0), 0) / allConcepts.length
    };

    res.json({
      ok: true,
      gaps: gaps.slice(0, 6), // Limit to top 6 gaps for clean UI
      allGapsCount: gaps.length,
      statistics: gapStats,
      insights,
      recommendations: gaps.slice(0, 5) // Top 5 priority gaps
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Helper function to generate learning plans with assignment and course references
function generateLearningPlan(concept) {
  const conceptName = concept.label.toLowerCase();
  const db = getDB();

  // Get actual course materials and assignments from database
  const syllabusConcepts = db.prepare(`
    SELECT label, provenance
    FROM concepts
    WHERE source_graph = 'syllabus'
    AND norm_label LIKE ?
    LIMIT 5
  `).all(`%${concept.norm_label}%`);

  const relatedAssignments = db.prepare(`
    SELECT label, provenance
    FROM concepts
    WHERE source_graph = 'syllabus'
    AND json_extract(provenance, '$.type') = 'assignment'
    AND (norm_label LIKE ? OR label LIKE ?)
    LIMIT 3
  `).all(`%${concept.norm_label}%`, `%${conceptName}%`);

  // Extract specific course materials
  const courseMaterials = syllabusConcepts.map(sc => {
    try {
      const prov = JSON.parse(sc.provenance || '{}');
      return { label: sc.label, ...prov };
    } catch {
      return { label: sc.label, type: 'unknown' };
    }
  });

  const assignments = relatedAssignments.map(ra => {
    try {
      const prov = JSON.parse(ra.provenance || '{}');
      return { label: ra.label, ...prov };
    } catch {
      return { label: ra.label, type: 'assignment' };
    }
  });

  // Extensive AI-like logic for diverse learning plans
  let plan = {
    steps: [],
    description: '',
    estimatedTime: '2-3 hours',
    difficulty: 'medium',
    recommendedAction: 'Study fundamentals and practice'
  };

  // Generate context-aware steps using actual course data
  const hasSpecificAssignments = assignments.length > 0;
  const hasCourseMaterials = courseMaterials.length > 0;

  // Machine Learning Concepts with dynamic references
  if (conceptName.includes('linear regression')) {
    const baseSteps = [
      'Review linear algebra fundamentals (vectors, matrices, dot products)',
      'Study the mathematical derivation of linear regression cost function',
      'Understand gradient descent optimization method',
      'Practice implementation from scratch',
      'Apply to real datasets and analyze results'
    ];

    // Enhance with specific course materials
    if (hasSpecificAssignments || hasCourseMaterials) {
      const specificSteps = [];

      // Add specific assignments if available
      assignments.forEach(assignment => {
        if (assignment.due_at) {
          const dueDate = new Date(assignment.due_at).toLocaleDateString();
          specificSteps.push(`Work on ${assignment.label} (due ${dueDate})`);
        } else {
          specificSteps.push(`Complete ${assignment.label}`);
        }
      });

      // Add course materials
      courseMaterials.forEach(material => {
        if (material.type === 'module_item') {
          specificSteps.push(`Study ${material.label} in course modules`);
        } else if (material.type === 'page') {
          specificSteps.push(`Review ${material.label} course page`);
        } else if (material.type === 'syllabus') {
          specificSteps.push(`Read syllabus section: ${material.label}`);
        }
      });

      plan = {
        steps: specificSteps.length > 0 ? specificSteps.concat(baseSteps.slice(specificSteps.length)) : baseSteps,
        description: hasSpecificAssignments
          ? `Linear regression appears in your course materials. Focus on ${assignments[0]?.label || 'related assignments'} for practical application.`
          : 'Linear regression is fundamental to machine learning. Master the mathematical foundation before moving to implementation.',
        estimatedTime: hasSpecificAssignments ? '6-8 hours' : '4-5 hours',
        difficulty: 'medium',
        recommendedAction: hasSpecificAssignments
          ? `Start with ${assignments[0]?.label || 'course assignments'}, then practice with additional datasets`
          : 'Begin with mathematical theory, then implement from scratch in Python'
      };
    } else {
      plan = {
        steps: baseSteps,
        description: 'Linear regression is fundamental to machine learning. Master the mathematical foundation before moving to implementation.',
        estimatedTime: '4-5 hours',
        difficulty: 'medium',
        recommendedAction: 'Begin with mathematical theory, then implement from scratch in Python'
      };
    }
  } else if (conceptName.includes('logistic regression')) {
    plan = {
      steps: [
        'Review Lecture 4: Why linear regression fails for classification problems',
        'Study Course Notes Section 2.2: Sigmoid function and maximum likelihood',
        'Complete Homework 1 Problem 3: Derive logistic regression cost function',
        'Work on Programming Assignment 1: Implement logistic regression classifier',
        'Test on Assignment dataset: Email spam classification (provided in course materials)'
      ],
      description: 'Essential for Homework 1 Problem 3 and Programming Assignment 1. Key concept for midterm exam.',
      estimatedTime: '3-4 hours',
      difficulty: 'medium',
      recommendedAction: 'Start with Homework 1 Problem 3, then tackle Programming Assignment 1'
    };
  } else if (conceptName.includes('neural network') || conceptName.includes('deep learning')) {
    plan = {
      steps: [
        'Study Lecture 8: Introduction to Neural Networks and biological motivation',
        'Review Course Notes Chapter 4: Perceptrons and activation functions',
        'Watch Lecture 9: Forward propagation walkthrough with course examples',
        'Complete Homework 2 Problem 4: Derive backpropagation algorithm by hand',
        'Work on Programming Assignment 3: Build neural network for MNIST digit recognition',
        'Prepare for Final Project: Choose neural network architecture for your dataset'
      ],
      description: 'Critical for Homework 2, Programming Assignment 3, and Final Project. Major topic on final exam.',
      estimatedTime: '6-8 hours',
      difficulty: 'high',
      recommendedAction: 'Start with Homework 2 Problem 4, then implement Programming Assignment 3 neural network'
    };
  } else if (conceptName.includes('decision tree') || conceptName.includes('random forest')) {
    plan = {
      steps: [
        'Review Lecture 6: Decision Trees and information gain calculations',
        'Study Course Notes Section 3.1: Entropy and Gini impurity measures',
        'Complete Homework 2 Problem 1: Build decision tree by hand for given dataset',
        'Work through Lab 3: Implement decision tree algorithm using course template',
        'Complete Programming Assignment 2: Random Forest ensemble for course competition',
        'Apply to Final Project: Consider decision trees for interpretable results'
      ],
      description: 'Important for Homework 2 Problem 1 and Lab 3. Useful for Final Project interpretability requirements.',
      estimatedTime: '3-4 hours',
      difficulty: 'easy',
      recommendedAction: 'Start with Homework 2 Problem 1, then complete Lab 3 implementation'
    };
  } else if (conceptName.includes('svm') || conceptName.includes('support vector')) {
    plan = {
      steps: [
        'Understand the concept of maximum margin classification',
        'Learn about support vectors and the margin',
        'Study the kernel trick for non-linear data',
        'Practice with different kernel functions (RBF, polynomial)',
        'Implement SVM using quadratic optimization',
        'Apply to text classification problems'
      ],
      description: 'SVMs are elegant mathematical models. Focus on the geometric intuition behind margin maximization.',
      estimatedTime: '4-5 hours',
      difficulty: 'high',
      recommendedAction: 'Study the math behind optimization, then experiment with scikit-learn'
    };
  } else if (conceptName.includes('clustering') || conceptName.includes('k-means')) {
    plan = {
      steps: [
        'Understand unsupervised learning vs supervised learning',
        'Learn the K-means algorithm step by step',
        'Practice choosing the right number of clusters (elbow method)',
        'Explore other clustering algorithms (hierarchical, DBSCAN)',
        'Apply clustering to customer segmentation',
        'Visualize clusters in 2D and interpret results'
      ],
      description: 'Clustering helps discover hidden patterns in data. Great introduction to unsupervised learning.',
      estimatedTime: '3-4 hours',
      difficulty: 'easy',
      recommendedAction: 'Start with visual examples, then implement K-means from scratch'
    };
  } else if (conceptName.includes('dimensionality reduction') || conceptName.includes('pca')) {
    plan = {
      steps: [
        'Understand the curse of dimensionality',
        'Learn Principal Component Analysis (PCA) mathematics',
        'Study eigenvalues and eigenvectors',
        'Implement PCA step by step',
        'Practice on high-dimensional datasets',
        'Explore t-SNE for visualization'
      ],
      description: 'Dimensionality reduction is crucial for handling high-dimensional data and visualization.',
      estimatedTime: '4-5 hours',
      difficulty: 'high',
      recommendedAction: 'Review linear algebra, then implement PCA in NumPy'
    };
  }

  // Programming Concepts
  else if (conceptName.includes('python') || conceptName.includes('programming')) {
    plan = {
      steps: [
        'Complete Course Setup Guide: Install Python, Jupyter, and course environment',
        'Work through Programming Tutorial 1: Python syntax and data structures',
        'Practice with Course Problem Set A: Basic Python exercises (required for PA1)',
        'Complete Lab 1: Python fundamentals using course Jupyter notebooks',
        'Apply to Programming Assignment 1: Implement linear regression in Python'
      ],
      description: 'Essential foundation for all programming assignments. Required for Programming Assignment 1 and Labs.',
      estimatedTime: '6-8 hours',
      difficulty: 'easy',
      recommendedAction: 'Complete Course Problem Set A, then start Programming Assignment 1'
    };
  } else if (conceptName.includes('pandas') || conceptName.includes('data manipulation')) {
    plan = {
      steps: [
        'Complete Lab 2: Data manipulation with pandas using course datasets',
        'Work through Programming Tutorial 2: DataFrame operations and cleaning',
        'Practice with Course Dataset 1: Clean and preprocess the provided housing data',
        'Complete Programming Assignment 1 Part 2: Data preprocessing pipeline',
        'Apply to Final Project: Use pandas for your chosen dataset preprocessing'
      ],
      description: 'Critical for Programming Assignment 1 and Final Project data preprocessing requirements.',
      estimatedTime: '4-5 hours',
      difficulty: 'medium',
      recommendedAction: 'Start with Lab 2, then work on Programming Assignment 1 Part 2'
    };
  } else if (conceptName.includes('numpy') || conceptName.includes('array')) {
    plan = {
      steps: [
        'Understand the difference between Python lists and NumPy arrays',
        'Learn array creation, indexing, and slicing',
        'Master broadcasting and vectorized operations',
        'Practice linear algebra operations: dot products, matrix multiplication',
        'Optimize code performance using NumPy functions'
      ],
      description: 'NumPy is the foundation of scientific computing in Python. Critical for ML implementations.',
      estimatedTime: '3-4 hours',
      difficulty: 'medium',
      recommendedAction: 'Work through NumPy quickstart guide, then optimize existing Python code'
    };
  } else if (conceptName.includes('matplotlib') || conceptName.includes('visualization')) {
    plan = {
      steps: [
        'Learn basic plotting: line plots, scatter plots, histograms',
        'Master figure customization: colors, labels, legends',
        'Create subplots for multiple visualizations',
        'Practice with different chart types: bar charts, box plots',
        'Build an interactive dashboard with widgets',
        'Create publication-quality figures'
      ],
      description: 'Data visualization is crucial for understanding and communicating insights.',
      estimatedTime: '4-5 hours',
      difficulty: 'easy',
      recommendedAction: 'Start with simple plots, gradually add complexity and customization'
    };
  }

  // Statistics Concepts
  else if (conceptName.includes('statistics') || conceptName.includes('probability')) {
    plan = {
      steps: [
        'Review basic probability: events, conditional probability',
        'Learn common distributions: normal, binomial, Poisson',
        'Understand descriptive statistics: mean, median, variance',
        'Study hypothesis testing and p-values',
        'Practice A/B testing scenarios',
        'Apply statistical inference to real problems'
      ],
      description: 'Statistics is the foundation of data science. Essential for understanding uncertainty and making decisions.',
      estimatedTime: '6-7 hours',
      difficulty: 'medium',
      recommendedAction: 'Start with Khan Academy statistics, then practice with real data'
    };
  } else if (conceptName.includes('hypothesis testing') || conceptName.includes('t-test')) {
    plan = {
      steps: [
        'Understand null and alternative hypotheses',
        'Learn about Type I and Type II errors',
        'Practice t-tests: one-sample, two-sample, paired',
        'Study chi-square tests for categorical data',
        'Learn when to use different statistical tests',
        'Interpret p-values and confidence intervals correctly'
      ],
      description: 'Hypothesis testing helps make data-driven decisions with statistical confidence.',
      estimatedTime: '4-5 hours',
      difficulty: 'medium',
      recommendedAction: 'Work through examples by hand, then use scipy.stats in Python'
    };
  }

  // Math Concepts
  else if (conceptName.includes('calculus') || conceptName.includes('derivative')) {
    plan = {
      steps: [
        'Review function basics and limits',
        'Learn derivative rules: power rule, product rule, chain rule',
        'Understand geometric interpretation of derivatives',
        'Practice optimization problems using derivatives',
        'Apply calculus to machine learning cost functions',
        'Study multivariable calculus basics'
      ],
      description: 'Calculus is essential for understanding optimization in machine learning.',
      estimatedTime: '8-10 hours',
      difficulty: 'high',
      recommendedAction: 'Use Khan Academy calculus course, focus on chain rule for ML'
    };
  } else if (conceptName.includes('linear algebra') || conceptName.includes('matrix')) {
    plan = {
      steps: [
        'Master vector operations: addition, scalar multiplication',
        'Learn matrix multiplication and properties',
        'Understand eigenvalues and eigenvectors',
        'Study matrix decompositions: SVD, LU, QR',
        'Practice solving linear systems',
        'Apply linear algebra to ML algorithms'
      ],
      description: 'Linear algebra is the language of machine learning. Vectors and matrices are everywhere.',
      estimatedTime: '10-12 hours',
      difficulty: 'high',
      recommendedAction: 'Use 3Blue1Brown\'s Essence of Linear Algebra, then practice in Python'
    };
  }

  // Default case with dynamic course-specific references
  else {
    const defaultSteps = [
      `Study ${concept.label} using available course materials`,
      'Connect this concept to related topics you have learned',
      'Practice with examples and exercises',
      'Apply to relevant assignments or projects',
      'Review for understanding and retention'
    ];

    const specificSteps = [];
    let specificDescription = '';
    let specificAction = '';

    // Use actual course materials if available
    if (hasSpecificAssignments || hasCourseMaterials) {
      // Add specific assignments
      assignments.forEach(assignment => {
        if (assignment.due_at) {
          const dueDate = new Date(assignment.due_at).toLocaleDateString();
          specificSteps.push(`Work on ${assignment.label} (due ${dueDate}) - this covers ${concept.label}`);
        } else {
          specificSteps.push(`Complete ${assignment.label} which includes ${concept.label}`);
        }
      });

      // Add specific course materials
      courseMaterials.forEach(material => {
        if (material.type === 'module_item') {
          specificSteps.push(`Study ${material.label} in your course modules`);
        } else if (material.type === 'page') {
          specificSteps.push(`Review ${material.label} in course materials`);
        } else if (material.type === 'syllabus') {
          specificSteps.push(`Read syllabus section: ${material.label}`);
        } else if (material.type === 'assignment_desc') {
          specificSteps.push(`Focus on ${material.label} assignment requirements`);
        }
      });

      if (assignments.length > 0) {
        specificDescription = `${concept.label} is covered in ${assignments[0].label}. Use this assignment to build practical understanding.`;
        specificAction = `Start with ${assignments[0].label}, then explore related course materials`;
      } else {
        specificDescription = `${concept.label} appears in your course materials. Focus on understanding through available resources.`;
        specificAction = `Review course materials, then find practical applications`;
      }
    }

    // Use specific steps if available, otherwise use default
    const finalSteps = specificSteps.length > 0
      ? specificSteps.concat(defaultSteps.slice(specificSteps.length))
      : defaultSteps;

    const finalDescription = specificDescription ||
      `${concept.label} is an important concept. Build understanding through systematic study and practice.`;

    const finalAction = specificAction ||
      `Start by understanding the fundamentals, then apply through practice and exercises`;

    plan = {
      steps: finalSteps,
      description: finalDescription,
      estimatedTime: hasSpecificAssignments ? '3-5 hours' : '2-4 hours',
      difficulty: hasSpecificAssignments ? 'medium' : 'easy',
      recommendedAction: finalAction
    };
  }

  return plan;
}

// Helper function to calculate priority
function calculatePriority(concept, relatedAssignments) {
  // High priority if related to upcoming assignments
  if (relatedAssignments.length > 0) {
    const hasUrgentAssignment = relatedAssignments.some(a => getAssignmentUrgency(a.dueDate) === 'urgent');
    if (hasUrgentAssignment) return 'high';
    return 'medium';
  }

  // Medium priority if currently learning
  if (concept.mastery === 'learning') return 'medium';

  // Low priority otherwise
  return 'low';
}

// Helper function to get assignment urgency
function getAssignmentUrgency(dueDate) {
  const now = new Date();
  const due = new Date(dueDate);
  const daysUntilDue = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

  if (daysUntilDue <= 3) return 'urgent';
  if (daysUntilDue <= 7) return 'soon';
  return 'later';
}

// Helper function to generate learning insights
function generateLearningInsights(gaps, allConcepts) {
  const insights = [];

  if (gaps.length === 0) {
    insights.push({
      type: 'success',
      message: 'Great progress! You have mastered most key concepts.',
      action: 'Consider exploring advanced topics or helping others learn.'
    });
  } else {
    const highPriorityGaps = gaps.filter(g => g.priority === 'high');
    if (highPriorityGaps.length > 0) {
      insights.push({
        type: 'urgent',
        message: `You have ${highPriorityGaps.length} high-priority learning gap${highPriorityGaps.length > 1 ? 's' : ''} related to upcoming assignments.`,
        action: 'Focus on these concepts first to prepare for your assignments.'
      });
    }

    const domainGaps = gaps.filter(g => g.source === 'domain');
    const syllabusGaps = gaps.filter(g => g.source === 'syllabus');

    if (domainGaps.length > syllabusGaps.length) {
      insights.push({
        type: 'suggestion',
        message: 'Most of your gaps are in general domain knowledge.',
        action: 'Consider supplementing your coursework with broader reading and tutorials.'
      });
    }
  }

  return insights;
}

// API endpoint for assignments (enhanced sample data with future Canvas integration)
router.get('/api/assignments', (req, res) => {
  try {
    const { status } = req.query;
    const db = getDB();

    // Enhanced sample data with more realistic assignment names and better integration
    const sampleAssignments = [
      {
        id: 'cs229_hw1',
        title: 'Homework 1: Supervised Learning Foundations',
        fullTitle: 'CS 229 Homework 1: Linear Regression and Logistic Regression Implementation',
        course: 'CS 229 - Machine Learning',
        category: 'homework',
        dueDate: '2024-09-20T23:59:00Z',
        status: 'pending',
        description: 'Implement linear and logistic regression from scratch. Analyze performance on real datasets.',
        instructions: 'Complete problems 1-4 in the homework PDF. Submit Python notebook with implementations and analysis.',
        points: 100,
        submissionType: 'online_upload',
        canvasUrl: 'https://canvas.stanford.edu/courses/cs229/assignments/hw1',
        estimatedTime: '8-12 hours',
        difficulty: 'medium',
        relatedConcepts: ['supervised learning', 'linear regression', 'logistic regression', 'gradient descent', 'cost functions'],
        prerequisites: ['linear algebra', 'calculus', 'python programming'],
        resources: [
          'Lecture slides 1-3',
          'Andrew Ng\'s ML Course videos',
          'NumPy documentation'
        ]
      },
      {
        id: 'cs229_quiz2',
        title: 'Quiz 2: Neural Networks and Deep Learning',
        fullTitle: 'CS 229 Quiz 2: Neural Network Fundamentals and Backpropagation',
        course: 'CS 229 - Machine Learning',
        category: 'quiz',
        dueDate: '2024-09-25T14:30:00Z',
        status: 'pending',
        description: 'Timed quiz covering neural network architectures, activation functions, and backpropagation algorithm.',
        instructions: '60-minute online quiz. Multiple choice and short answer questions.',
        points: 75,
        submissionType: 'online_quiz',
        canvasUrl: 'https://canvas.stanford.edu/courses/cs229/quizzes/quiz2',
        estimatedTime: '2-3 hours prep + 1 hour quiz',
        difficulty: 'high',
        relatedConcepts: ['neural networks', 'backpropagation', 'activation functions', 'deep learning', 'feedforward networks'],
        prerequisites: ['linear regression', 'calculus derivatives', 'chain rule'],
        resources: [
          'Lecture slides 4-6',
          '3Blue1Brown Neural Networks series',
          'Deep Learning book chapters 6-7'
        ]
      },
      {
        id: 'cs229_project1',
        title: 'Project 1: ML Classification Challenge',
        fullTitle: 'CS 229 Project 1: Multi-class Classification on Real-world Dataset',
        course: 'CS 229 - Machine Learning',
        category: 'project',
        dueDate: '2024-10-05T23:59:00Z',
        status: 'pending',
        description: 'Apply multiple classification algorithms to a provided dataset. Compare performance and analyze results.',
        instructions: 'Form teams of 2-3. Choose dataset from provided options. Implement at least 3 different algorithms.',
        points: 150,
        submissionType: 'online_upload',
        canvasUrl: 'https://canvas.stanford.edu/courses/cs229/assignments/project1',
        estimatedTime: '15-20 hours',
        difficulty: 'high',
        relatedConcepts: ['classification', 'support vector machines', 'decision trees', 'ensemble methods', 'cross validation'],
        prerequisites: ['supervised learning', 'python programming', 'data preprocessing'],
        resources: [
          'Project guidelines PDF',
          'Scikit-learn documentation',
          'Kaggle Learn courses'
        ]
      },
      {
        id: 'cs229_hw0',
        title: 'Homework 0: Mathematical Prerequisites',
        fullTitle: 'CS 229 Homework 0: Linear Algebra and Probability Review',
        course: 'CS 229 - Machine Learning',
        category: 'homework',
        dueDate: '2024-09-08T23:59:00Z',
        status: 'completed',
        description: 'Review of essential mathematical concepts: linear algebra, probability, and calculus.',
        instructions: 'Complete all problems in the math review worksheet. Show your work clearly.',
        points: 50,
        grade: 47,
        submissionType: 'online_upload',
        canvasUrl: 'https://canvas.stanford.edu/courses/cs229/assignments/hw0',
        estimatedTime: '4-6 hours',
        difficulty: 'medium',
        relatedConcepts: ['linear algebra', 'probability', 'calculus', 'statistics'],
        prerequisites: ['high school algebra', 'basic calculus'],
        resources: [
          'Math review handout',
          'Khan Academy linear algebra',
          'CS229 math notes'
        ]
      },
      {
        id: 'cs229_midterm',
        title: 'Midterm Exam',
        fullTitle: 'CS 229 Midterm Examination: Comprehensive ML Fundamentals',
        course: 'CS 229 - Machine Learning',
        category: 'exam',
        dueDate: '2024-10-15T16:30:00Z',
        status: 'pending',
        description: 'Comprehensive exam covering all material from weeks 1-6. Mix of theoretical and practical questions.',
        instructions: 'In-person exam in Hewlett 200. Bring calculator and student ID. No notes allowed.',
        points: 200,
        submissionType: 'in_person',
        canvasUrl: 'https://canvas.stanford.edu/courses/cs229/assignments/midterm',
        estimatedTime: '10-15 hours prep + 2 hour exam',
        difficulty: 'high',
        relatedConcepts: ['supervised learning', 'unsupervised learning', 'neural networks', 'svm', 'bias variance tradeoff'],
        prerequisites: ['all previous homework', 'lecture attendance', 'section participation'],
        resources: [
          'All lecture slides',
          'Previous years\' exams',
          'Office hours review sessions'
        ]
      }
    ];

    // Get learning progress for related concepts
    const conceptProgress = db.prepare(`
      SELECT norm_label, mastery, score
      FROM concepts c
      LEFT JOIN progress p ON p.concept_id = c.id
      WHERE c.source_graph = 'personal'
    `).all();

    const progressMap = {};
    conceptProgress.forEach(cp => {
      progressMap[cp.norm_label] = { mastery: cp.mastery, score: cp.score };
    });

    // Enhance assignments with learning progress and gap analysis
    const enhancedAssignments = sampleAssignments.map(assignment => {
      // Calculate concept progress and readiness
      const conceptProgress = assignment.relatedConcepts.map(concept => ({
        concept,
        mastery: progressMap[concept]?.mastery || 'unknown',
        score: progressMap[concept]?.score || 0
      }));

      const readiness = assignment.relatedConcepts.reduce((acc, concept) => {
        const progress = progressMap[concept];
        if (progress?.mastery === 'known') acc += 1;
        else if (progress?.mastery === 'learning') acc += 0.5;
        return acc;
      }, 0) / assignment.relatedConcepts.length;

      // Identify missing prerequisites
      const missingPrerequisites = assignment.prerequisites.filter(prereq => {
        const progress = progressMap[prereq];
        return !progress || progress.mastery !== 'known';
      });

      // Calculate urgency based on due date and readiness
      const now = new Date();
      const dueDate = new Date(assignment.dueDate);
      const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

      let urgency = 'normal';
      if (daysUntilDue <= 3) urgency = 'urgent';
      else if (daysUntilDue <= 7) urgency = 'soon';
      else if (daysUntilDue > 14) urgency = 'future';

      // Generate readiness assessment
      let readinessLevel = 'ready';
      if (readiness < 0.3) readinessLevel = 'not_ready';
      else if (readiness < 0.7) readinessLevel = 'partially_ready';

      return {
        ...assignment,
        conceptProgress,
        readiness,
        readinessLevel,
        missingPrerequisites,
        urgency,
        daysUntilDue,
        categoryIcon: getCategoryIcon(assignment.category),
        difficultyColor: getDifficultyColor(assignment.difficulty),
        // Add learning recommendations specific to this assignment
        learningRecommendations: missingPrerequisites.slice(0, 3).map(prereq => ({
          concept: prereq,
          action: `Review ${prereq} before attempting this assignment`,
          priority: 'high'
        }))
      };
    });

    // Helper function to get category icons
    function getCategoryIcon(category) {
      switch (category) {
        case 'homework': return '📝';
        case 'quiz': return '📋';
        case 'project': return '🚀';
        case 'exam': return '📊';
        default: return '📄';
      }
    }

    // Helper function to get difficulty colors
    function getDifficultyColor(difficulty) {
      switch (difficulty) {
        case 'easy': return '#10b981';
        case 'medium': return '#f59e0b';
        case 'hard':
        case 'high': return '#ef4444';
        default: return '#6b7280';
      }
    }

    // Filter by status if provided
    let filteredAssignments = enhancedAssignments;
    if (status && status !== 'all') {
      // Handle 'overdue' status
      if (status === 'overdue') {
        const now = new Date();
        filteredAssignments = enhancedAssignments.filter(a =>
          a.status === 'pending' && new Date(a.dueDate) < now
        );
      } else {
        filteredAssignments = enhancedAssignments.filter(a => a.status === status);
      }
    }

    const summary = {
      total: enhancedAssignments.length,
      pending: enhancedAssignments.filter(a => a.status === 'pending').length,
      completed: enhancedAssignments.filter(a => a.status === 'completed').length,
      overdue: enhancedAssignments.filter(a => {
        const now = new Date();
        return a.status === 'pending' && new Date(a.dueDate) < now;
      }).length,
      totalPoints: enhancedAssignments.reduce((sum, a) => sum + a.points, 0),
      earnedPoints: enhancedAssignments.filter(a => a.grade).reduce((sum, a) => sum + (a.grade || 0), 0),
      averageReadiness: enhancedAssignments.reduce((sum, a) => sum + a.readiness, 0) / enhancedAssignments.length
    };

    res.json({
      ok: true,
      assignments: filteredAssignments,
      summary,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Individual graph endpoints for MCP resources
router.get('/api/graphs/domain', (req, res) => {
  try {
    const mermaid = getLatestSnapshotsAll();
    const domainGraph = mermaid.dg;

    // Parse nodes and edges from mermaid
    const nodes = [];
    const edges = [];

    if (domainGraph) {
      const nodeMatches = domainGraph.match(/\w+\["([^"]+)"\]/g) || [];
      nodeMatches.forEach(match => {
        const id = match.split('[')[0];
        const label = match.match(/\["([^"]+)"\]/)?.[1];
        if (label && !label.includes('…')) {
          nodes.push({ id, label, graph: 'domain' });
        }
      });

      const edgeMatches = domainGraph.match(/\w+\s*-->\s*\w+/g) || [];
      edges.forEach(match => {
        const [source, target] = match.split('-->').map(s => s.trim());
        edges.push({ source, target });
      });
    }

    res.json({
      ok: true,
      mermaid: domainGraph,
      nodes,
      edges,
      stats: {
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/graphs/syllabus', (req, res) => {
  try {
    const mermaid = getLatestSnapshotsAll();
    const syllabusGraph = mermaid.sg;

    // Parse nodes and edges from mermaid
    const nodes = [];
    const edges = [];

    if (syllabusGraph) {
      const nodeMatches = syllabusGraph.match(/\w+\["([^"]+)"\]/g) || [];
      nodeMatches.forEach(match => {
        const id = match.split('[')[0];
        const label = match.match(/\["([^"]+)"\]/)?.[1];
        if (label && !label.includes('…')) {
          nodes.push({
            id,
            label,
            graph: 'syllabus',
            type: label.toLowerCase().includes('assignment') ? 'assignment' :
                  label.toLowerCase().includes('outcome') ? 'outcome' : 'concept'
          });
        }
      });

      const edgeMatches = syllabusGraph.match(/\w+\s*-->\s*\w+/g) || [];
      edges.forEach(match => {
        const [source, target] = match.split('-->').map(s => s.trim());
        edges.push({ source, target });
      });
    }

    res.json({
      ok: true,
      mermaid: syllabusGraph,
      nodes,
      edges,
      stats: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        concepts: nodes.filter(n => n.type === 'concept').length,
        assignments: nodes.filter(n => n.type === 'assignment').length,
        outcomes: nodes.filter(n => n.type === 'outcome').length
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/graphs/personal', (req, res) => {
  try {
    const db = getDB();
    const mermaid = getLatestSnapshotsAll();
    const personalGraph = mermaid.pg;

    // Get detailed progress data
    const progressData = db.prepare(`
      SELECT
        c.id,
        c.label,
        c.norm_label,
        p.mastery,
        p.score,
        p.last_updated
      FROM concepts c
      LEFT JOIN progress p ON p.concept_id = c.id
      WHERE c.source_graph = 'personal'
      ORDER BY p.last_updated DESC
    `).all();

    res.json({
      ok: true,
      mermaid: personalGraph,
      progress: progressData,
      stats: {
        totalConcepts: progressData.length,
        knownConcepts: progressData.filter(p => p.mastery === 'known').length,
        learningConcepts: progressData.filter(p => p.mastery === 'learning').length,
        averageScore: progressData.reduce((sum, p) => sum + (p.score || 0), 0) / progressData.length
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// API endpoint for session reset
router.post('/api/reset', (req, res) => {
  try {
    const db = getDB();

    // Clear all learning data in a transaction
    db.transaction(() => {
      // Clear events (conversation history)
      db.prepare('DELETE FROM events').run();

      // Clear progress tracking
      db.prepare('DELETE FROM progress').run();

      // Clear concepts (this will cascade to progress via foreign key)
      db.prepare('DELETE FROM concepts').run();

      // Clear alignments
      db.prepare('DELETE FROM alignments').run();

      // Clear any graph snapshots
      db.prepare('DELETE FROM snapshots').run();

      // Clear any session state
      try {
        db.prepare('DELETE FROM session_state').run();
      } catch (e) {
        // Table might not exist, that's okay
      }
    })();

    res.json({
      ok: true,
      message: 'All learning data cleared successfully',
      cleared: {
        events: true,
        progress: true,
        concepts: true,
        alignments: true,
        snapshots: true
      },
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('Reset failed:', e);
    res.status(500).json({
      ok: false,
      error: e.message,
      message: 'Failed to reset session data'
    });
  }
});

export default router;