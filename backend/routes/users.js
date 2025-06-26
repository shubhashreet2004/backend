import express from 'express';
import User from '../models/User.js';
import Thread from '../models/Thread.js';
import Post from '../models/Post.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get user profile
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findOne({ 
      _id: req.params.id, 
      isActive: true 
    }).select('-password -email');
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Get user's recent threads
    const recentThreads = await Thread.find({ 
      author: user._id, 
      isActive: true 
    })
      .populate('category', 'name color')
      .sort({ createdAt: -1 })
      .limit(5);

    // Get user's recent posts
    const recentPosts = await Post.find({ 
      author: user._id, 
      isActive: true 
    })
      .populate('thread', 'title')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      data: {
        user,
        recentThreads,
        recentPosts,
        stats: {
          threadsCount: await Thread.countDocuments({ 
            author: user._id, 
            isActive: true 
          }),
          postsCount: await Post.countDocuments({ 
            author: user._id, 
            isActive: true 
          })
        }
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { bio, avatar } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { 
        bio: bio || req.user.bio, 
        avatar: avatar || req.user.avatar 
      },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    res.json({
      success: true,
      data: user,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get user's threads
router.get('/:id/threads', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const threads = await Thread.find({ 
      author: req.params.id, 
      isActive: true 
    })
      .populate('category', 'name color')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Thread.countDocuments({ 
      author: req.params.id, 
      isActive: true 
    });

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
    console.error('Get user threads error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get user's posts
router.get('/:id/posts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const posts = await Post.find({ 
      author: req.params.id, 
      isActive: true 
    })
      .populate('thread', 'title')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Post.countDocuments({ 
      author: req.params.id, 
      isActive: true 
    });

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalPosts: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Search users
router.get('/', async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;
    
    let query = { isActive: true };
    
    if (q) {
      query.$or = [
        { username: { $regex: q, $options: 'i' } },
        { bio: { $regex: q, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password -email')
      .sort({ reputation: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalUsers: total,
          hasNext: parseInt(page) < Math.ceil(total / parseInt(limit)),
          hasPrev: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;