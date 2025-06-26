import express from 'express';
import Post from '../models/Post.js';
import Thread from '../models/Thread.js';
import User from '../models/User.js';
import Category from '../models/Category.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Get posts for a thread
router.get('/thread/:threadId', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // Verify thread exists
    const thread = await Thread.findOne({ 
      _id: req.params.threadId, 
      isActive: true 
    });
    
    if (!thread) {
      return res.status(404).json({ 
        success: false,
        message: 'Thread not found' 
      });
    }

    const posts = await Post.find({ 
      thread: req.params.threadId, 
      isActive: true 
    })
      .populate('author', 'username avatar role postCount createdAt')
      .populate('parentPost', 'content author')
      .sort({ createdAt: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Post.countDocuments({ 
      thread: req.params.threadId, 
      isActive: true 
    });

    // Add hasLiked field for authenticated users
    const postsWithLikes = posts.map(post => {
      let hasLiked = false;
      if (req.user) {
        hasLiked = post.likes.some(like => 
          like.user.toString() === req.user._id.toString()
        );
      }
      return {
        ...post.toObject(),
        hasLiked,
        likeCount: post.likes.length
      };
    });

    res.json({
      success: true,
      data: {
        posts: postsWithLikes,
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
    console.error('Get posts error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Create new post
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { content, threadId, parentPostId } = req.body;

    // Validation
    if (!content || !threadId) {
      return res.status(400).json({ 
        success: false,
        message: 'Content and thread ID are required' 
      });
    }

    // Verify thread exists and is not locked
    const thread = await Thread.findOne({ 
      _id: threadId, 
      isActive: true 
    });
    
    if (!thread) {
      return res.status(404).json({ 
        success: false,
        message: 'Thread not found' 
      });
    }

    if (thread.isLocked) {
      return res.status(403).json({ 
        success: false,
        message: 'Thread is locked' 
      });
    }

    // Verify parent post exists if provided
    if (parentPostId) {
      const parentPost = await Post.findOne({ 
        _id: parentPostId, 
        thread: threadId, 
        isActive: true 
      });
      
      if (!parentPost) {
        return res.status(404).json({ 
          success: false,
          message: 'Parent post not found' 
        });
      }
    }

    const post = new Post({
      content,
      author: req.user._id,
      thread: threadId,
      parentPost: parentPostId || null
    });

    await post.save();

    // Update thread reply count and last reply
    await Thread.findByIdAndUpdate(threadId, {
      $inc: { replyCount: 1 },
      lastReply: {
        author: req.user._id,
        createdAt: new Date()
      }
    });

    // Update user post count
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { postCount: 1 }
    });

    // Update category post count
    await Category.findByIdAndUpdate(thread.category, {
      $inc: { postCount: 1 }
    });

    const populatedPost = await Post.findById(post._id)
      .populate('author', 'username avatar role postCount createdAt')
      .populate('parentPost', 'content author');

    res.status(201).json({
      success: true,
      data: {
        ...populatedPost.toObject(),
        hasLiked: false,
        likeCount: 0
      },
      message: 'Post created successfully'
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Like/Unlike post
router.post('/:id/like', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findOne({ 
      _id: req.params.id, 
      isActive: true 
    });
    
    if (!post) {
      return res.status(404).json({ 
        success: false,
        message: 'Post not found' 
      });
    }

    const existingLike = post.likes.find(
      like => like.user.toString() === req.user._id.toString()
    );

    if (existingLike) {
      post.likes = post.likes.filter(
        like => like.user.toString() !== req.user._id.toString()
      );
    } else {
      post.likes.push({ user: req.user._id });
    }

    await post.save();
    
    res.json({ 
      success: true,
      data: {
        liked: !existingLike, 
        likeCount: post.likes.length
      },
      message: existingLike ? 'Post unliked' : 'Post liked'
    });
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update post (author only)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ 
        success: false,
        message: 'Content is required' 
      });
    }

    const post = await Post.findOne({ 
      _id: req.params.id, 
      isActive: true 
    });

    if (!post) {
      return res.status(404).json({ 
        success: false,
        message: 'Post not found' 
      });
    }

    // Check if user is author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to edit this post' 
      });
    }

    // Save edit history
    post.editHistory.push({
      content: post.content,
      editedAt: new Date()
    });

    post.content = content;
    post.isEdited = true;
    post.editedAt = new Date();

    await post.save();

    const populatedPost = await Post.findById(post._id)
      .populate('author', 'username avatar role postCount createdAt')
      .populate('parentPost', 'content author');

    res.json({
      success: true,
      data: populatedPost,
      message: 'Post updated successfully'
    });
  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete post (author or admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findOne({ 
      _id: req.params.id, 
      isActive: true 
    }).populate('thread');

    if (!post) {
      return res.status(404).json({ 
        success: false,
        message: 'Post not found' 
      });
    }

    // Check if user is author or admin
    if (post.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to delete this post' 
      });
    }

    post.isActive = false;
    await post.save();

    // Update thread reply count
    await Thread.findByIdAndUpdate(post.thread._id, {
      $inc: { replyCount: -1 }
    });

    // Update user post count
    await User.findByIdAndUpdate(post.author, {
      $inc: { postCount: -1 }
    });

    // Update category post count
    await Category.findByIdAndUpdate(post.thread.category, {
      $inc: { postCount: -1 }
    });

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;