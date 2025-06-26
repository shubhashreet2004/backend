import express from 'express';
import Thread from '../models/Thread.js';
import Category from '../models/Category.js';
import User from '../models/User.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Get all threads with pagination and filtering
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const category = req.query.category;
    const search = req.query.search;
    const sort = req.query.sort || 'recent';

    let query = { isActive: true };
    
    if (category) {
      query.category = category;
    }

    if (search) {
      query.$text = { $search: search };
    }

    let sortOption = {};
    switch (sort) {
      case 'popular':
        sortOption = { views: -1, createdAt: -1 };
        break;
      case 'replies':
        sortOption = { replyCount: -1, createdAt: -1 };
        break;
      case 'likes':
        sortOption = { 'likes.length': -1, createdAt: -1 };
        break;
      default:
        sortOption = { isPinned: -1, 'lastReply.createdAt': -1, createdAt: -1 };
    }

    const threads = await Thread.find(query)
      .populate('author', 'username avatar role')
      .populate('category', 'name color')
      .populate('lastReply.author', 'username avatar')
      .sort(sortOption)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Thread.countDocuments(query);

    res.json({
      success: true,
      data: {
        threads,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalThreads: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Get threads error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get single thread
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const thread = await Thread.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $inc: { views: 1 } },
      { new: true }
    )
      .populate('author', 'username avatar role postCount createdAt')
      .populate('category', 'name color');

    if (!thread) {
      return res.status(404).json({ 
        success: false,
        message: 'Thread not found' 
      });
    }

    // Check if current user has liked this thread
    let hasLiked = false;
    if (req.user) {
      hasLiked = thread.likes.some(like => 
        like.user.toString() === req.user._id.toString()
      );
    }

    res.json({
      success: true,
      data: {
        ...thread.toObject(),
        hasLiked,
        likeCount: thread.likes.length
      }
    });
  } catch (error) {
    console.error('Get thread error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Create new thread
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, content, category, tags } = req.body;

    // Validation
    if (!title || !content || !category) {
      return res.status(400).json({ 
        success: false,
        message: 'Title, content, and category are required' 
      });
    }

    // Verify category exists
    const categoryExists = await Category.findOne({ 
      _id: category, 
      isActive: true 
    });
    
    if (!categoryExists) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid category' 
      });
    }

    const thread = new Thread({
      title,
      content,
      author: req.user._id,
      category,
      tags: tags || []
    });

    await thread.save();

    // Update category thread count
    await Category.findByIdAndUpdate(category, {
      $inc: { threadCount: 1 }
    });

    // Update user post count
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { postCount: 1 }
    });

    const populatedThread = await Thread.findById(thread._id)
      .populate('author', 'username avatar role')
      .populate('category', 'name color');

    res.status(201).json({
      success: true,
      data: populatedThread,
      message: 'Thread created successfully'
    });
  } catch (error) {
    console.error('Create thread error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Like/Unlike thread
router.post('/:id/like', authenticateToken, async (req, res) => {
  try {
    const thread = await Thread.findOne({ 
      _id: req.params.id, 
      isActive: true 
    });
    
    if (!thread) {
      return res.status(404).json({ 
        success: false,
        message: 'Thread not found' 
      });
    }

    const existingLike = thread.likes.find(
      like => like.user.toString() === req.user._id.toString()
    );

    if (existingLike) {
      thread.likes = thread.likes.filter(
        like => like.user.toString() !== req.user._id.toString()
      );
    } else {
      thread.likes.push({ user: req.user._id });
    }

    await thread.save();
    
    res.json({ 
      success: true,
      data: {
        liked: !existingLike, 
        likeCount: thread.likes.length
      },
      message: existingLike ? 'Thread unliked' : 'Thread liked'
    });
  } catch (error) {
    console.error('Like thread error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update thread (author or admin only)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    
    const thread = await Thread.findOne({ 
      _id: req.params.id, 
      isActive: true 
    });

    if (!thread) {
      return res.status(404).json({ 
        success: false,
        message: 'Thread not found' 
      });
    }

    // Check if user is author or admin
    if (thread.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to edit this thread' 
      });
    }

    if (title) thread.title = title;
    if (content) thread.content = content;
    if (tags) thread.tags = tags;

    await thread.save();

    const populatedThread = await Thread.findById(thread._id)
      .populate('author', 'username avatar role')
      .populate('category', 'name color');

    res.json({
      success: true,
      data: populatedThread,
      message: 'Thread updated successfully'
    });
  } catch (error) {
    console.error('Update thread error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete thread (author or admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const thread = await Thread.findOne({ 
      _id: req.params.id, 
      isActive: true 
    });

    if (!thread) {
      return res.status(404).json({ 
        success: false,
        message: 'Thread not found' 
      });
    }

    // Check if user is author or admin
    if (thread.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to delete this thread' 
      });
    }

    thread.isActive = false;
    await thread.save();

    // Update category thread count
    await Category.findByIdAndUpdate(thread.category, {
      $inc: { threadCount: -1 }
    });

    res.json({
      success: true,
      message: 'Thread deleted successfully'
    });
  } catch (error) {
    console.error('Delete thread error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;