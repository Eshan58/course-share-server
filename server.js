const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Atlas Connection
const uri =
  "mongodb+srv://mahdiashan9_db_user:ogNJXZ9ICIBH8dhs@cluster0.qj2eop5.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// Replace <db_password> with your actual password
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;

// Connect to MongoDB
async function connectDB() {
  try {
    await client.connect();
    db = client.db("courseshare"); // Database name
    console.log("Connected to MongoDB Atlas");

    // Create collections if they don't exist
    await db.createCollection("users");
    await db.createCollection("courses");
    await db.createCollection("enrollments");

    console.log("Database collections ready");

    // Seed sample data
    await seedData();
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
}

// Database models (using MongoDB native driver)
const userSchema = {
  uid: { type: "string", required: true },
  email: { type: "string", required: true },
  displayName: { type: "string", required: true },
  photoURL: { type: "string", default: "" },
  role: { type: "string", enum: ["student", "instructor"], default: "student" },
  createdAt: { type: "date", default: new Date() },
  updatedAt: { type: "date", default: new Date() },
};

// Simple Auth Middleware

// ADD THIS - More permissive CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:3001",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const auth = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res
        .status(401)
        .json({ message: "No token, authorization denied" });
    }

    // For demo - using token as user ID
    req.user = {
      uid: token || "demo-user-123",
      email: "user@example.com",
      displayName: "Demo User",
      photoURL: "",
    };

    next();
  } catch (error) {
    res.status(401).json({ message: "Token is not valid" });
  }
};

// ==================== ROUTES ====================

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    message: "CourseShare API is running!",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    database: db ? "Connected" : "Disconnected",
  });
});

// ===== COURSE ROUTES =====

// Get all courses with filtering
app.get("/api/courses", async (req, res) => {
  try {
    const { category, featured, search, limit = 12, page = 1 } = req.query;

    let filter = {};

    if (category && category !== "all") filter.category = category;
    if (featured === "true") filter.isFeatured = true;

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { "instructor.name": { $regex: search, $options: "i" } },
      ];
    }

    const courses = await db
      .collection("courses")
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .toArray();

    const total = await db.collection("courses").countDocuments(filter);

    res.json({
      success: true,
      courses,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error("Error fetching courses:", error);
    res.status(500).json({ success: false, message: "Error fetching courses" });
  }
});

// Get single course with proper ObjectId handling - REMOVED DUPLICATES
app.get("/api/courses/:id", async (req, res) => {
  try {
    const courseId = req.params.id;

    console.log("Fetching course with ID:", courseId);

    // Validate if it's a valid ObjectId
    if (!ObjectId.isValid(courseId)) {
      console.log("Invalid ObjectId format:", courseId);
      return res.status(400).json({
        success: false,
        message: "Invalid course ID format",
      });
    }

    const course = await db.collection("courses").findOne({
      _id: new ObjectId(courseId),
    });

    console.log("Course found:", course ? `"${course.title}"` : "No");

    if (!course) {
      console.log("Course not found in database:", courseId);
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    console.log("Course retrieved successfully");
    res.json({
      success: true,
      course,
    });
  } catch (error) {
    console.error("Error fetching course:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching course",
      error: error.message,
    });
  }
});

// Create new course
app.post("/api/courses", auth, async (req, res) => {
  try {
    const courseData = {
      ...req.body,
      owner: req.user.uid,
      instructor: {
        name: req.user.displayName,
        email: req.user.email,
        photo: req.user.photoURL,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      students: 0,
      rating: 0,
      lessons: 0,
    };

    const result = await db.collection("courses").insertOne(courseData);
    const course = { _id: result.insertedId, ...courseData };

    res.status(201).json({ success: true, course });
  } catch (error) {
    console.error("Error creating course:", error);
    res.status(500).json({ success: false, message: "Error creating course" });
  }
});

//  FIXED: Update course with proper ObjectId handling
app.put("/api/courses/:id", auth, async (req, res) => {
  try {
    const courseId = req.params.id;

    // Validate ObjectId
    if (!ObjectId.isValid(courseId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid course ID format",
      });
    }

    const course = await db.collection("courses").findOne({
      _id: new ObjectId(courseId),
    });

    if (!course) {
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });
    }

    if (course.owner !== req.user.uid) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this course",
      });
    }

    const updateData = {
      ...req.body,
      updatedAt: new Date(),
    };

    await db
      .collection("courses")
      .updateOne({ _id: new ObjectId(courseId) }, { $set: updateData });

    const updatedCourse = await db
      .collection("courses")
      .findOne({ _id: new ObjectId(courseId) });

    res.json({ success: true, course: updatedCourse });
  } catch (error) {
    console.error("Error updating course:", error);
    res.status(500).json({ success: false, message: "Error updating course" });
  }
});

// Enroll in course with proper ObjectId handling
app.post("/api/courses/:id/enroll", auth, async (req, res) => {
  try {
    const courseId = req.params.id;

    console.log(
      "Enrollment request for course:",
      courseId,
      "by user:",
      req.user.uid
    );

    // Validate ObjectId
    if (!ObjectId.isValid(courseId)) {
      console.log("Invalid course ID format:", courseId);
      return res.status(400).json({
        success: false,
        message: "Invalid course ID format",
      });
    }

    const course = await db.collection("courses").findOne({
      _id: new ObjectId(courseId),
    });

    if (!course) {
      console.log("Course not found:", courseId);
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });
    }

    const existingEnrollment = await db.collection("enrollments").findOne({
      userId: req.user.uid,
      courseId: courseId,
    });

    if (existingEnrollment) {
      console.log("User already enrolled in course:", courseId);
      return res
        .status(400)
        .json({ success: false, message: "Already enrolled in this course" });
    }

    const enrollment = {
      userId: req.user.uid,
      courseId: courseId,
      enrolledAt: new Date(),
      progress: 0,
      completedLessons: 0,
      totalLessons: course.lessons || 10,
      lastAccessed: new Date(),
      status: "active",
    };

    const result = await db.collection("enrollments").insertOne(enrollment);
    const newEnrollment = { _id: result.insertedId, ...enrollment };

    // Update course student count
    await db
      .collection("courses")
      .updateOne({ _id: new ObjectId(courseId) }, { $inc: { students: 1 } });

    console.log("Enrollment successful for course:", courseId);

    res.status(201).json({
      success: true,
      message: "Successfully enrolled in course",
      enrollment: newEnrollment,
    });
  } catch (error) {
    console.error("Error enrolling in course:", error);
    res
      .status(500)
      .json({ success: false, message: "Error enrolling in course" });
  }
});

// ===== ENROLLMENT ROUTES =====

// Get user's enrolled courses
app.get("/api/enrollments/my-courses", auth, async (req, res) => {
  try {
    const enrollments = await db
      .collection("enrollments")
      .find({ userId: req.user.uid })
      .sort({ enrolledAt: -1 })
      .toArray();

    // Get course details for each enrollment
    const enrolledCourses = await Promise.all(
      enrollments.map(async (enrollment) => {
        // Validate ObjectId before querying
        if (!ObjectId.isValid(enrollment.courseId)) {
          console.warn(
            `Invalid courseId in enrollment: ${enrollment.courseId}`
          );
          return null;
        }

        const course = await db.collection("courses").findOne({
          _id: new ObjectId(enrollment.courseId),
        });

        if (!course) {
          console.warn(
            `Course not found for enrollment: ${enrollment.courseId}`
          );
          return null;
        }

        return {
          _id: enrollment._id,
          courseId: enrollment.courseId,
          title: course?.title,
          image: course?.image,
          instructor: course?.instructor?.name,
          enrolledAt: enrollment.enrolledAt,
          progress: enrollment.progress,
          lastAccessed: enrollment.lastAccessed,
          totalLessons: enrollment.totalLessons,
          completedLessons: enrollment.completedLessons,
          status: enrollment.status,
          category: course?.category,
          duration: course?.duration,
          price: course?.price,
          description: course?.description,
        };
      })
    );

    // Filter out null values from invalid enrollments
    const validCourses = enrolledCourses.filter((course) => course !== null);

    res.json({ success: true, courses: validCourses });
  } catch (error) {
    console.error("Error fetching enrolled courses:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching enrolled courses" });
  }
});

// Update enrollment progress
app.put("/api/enrollments/:id/progress", auth, async (req, res) => {
  try {
    const { progress, completedLessons } = req.body;
    const enrollmentId = req.params.id;

    // Validate ObjectId
    if (!ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID format",
      });
    }

    const enrollment = await db.collection("enrollments").findOne({
      _id: new ObjectId(enrollmentId),
      userId: req.user.uid,
    });

    if (!enrollment) {
      return res
        .status(404)
        .json({ success: false, message: "Enrollment not found" });
    }

    const updateData = {
      progress: Math.min(progress, 100),
      lastAccessed: new Date(),
    };

    if (completedLessons !== undefined) {
      updateData.completedLessons = completedLessons;
    }

    // Update status based on progress
    if (updateData.progress === 0) {
      updateData.status = "not-started";
    } else if (updateData.progress === 100) {
      updateData.status = "completed";
    } else {
      updateData.status = "in-progress";
    }

    await db
      .collection("enrollments")
      .updateOne({ _id: new ObjectId(enrollmentId) }, { $set: updateData });

    const updatedEnrollment = await db
      .collection("enrollments")
      .findOne({ _id: new ObjectId(enrollmentId) });

    res.json({ success: true, enrollment: updatedEnrollment });
  } catch (error) {
    console.error("Error updating progress:", error);
    res
      .status(500)
      .json({ success: false, message: "Error updating progress" });
  }
});

// Check if user is enrolled in a course
app.get("/api/enrollments/check/:courseId", auth, async (req, res) => {
  try {
    const enrollment = await db.collection("enrollments").findOne({
      userId: req.user.uid,
      courseId: req.params.courseId,
    });

    res.json({ success: true, isEnrolled: !!enrollment, enrollment });
  } catch (error) {
    console.error("Error checking enrollment:", error);
    res
      .status(500)
      .json({ success: false, message: "Error checking enrollment" });
  }
});

// ===== USER ROUTES =====

// Create or get user
app.post("/api/users", auth, async (req, res) => {
  try {
    let user = await db.collection("users").findOne({ uid: req.user.uid });

    if (!user) {
      const newUser = {
        uid: req.user.uid,
        email: req.user.email,
        displayName: req.user.displayName,
        photoURL: req.user.photoURL,
        role: "student",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await db.collection("users").insertOne(newUser);
      user = { _id: result.insertedId, ...newUser };
    }

    res.json({ success: true, user });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ success: false, message: "Error creating user" });
  }
});

// Get user profile
app.get("/api/users/me", auth, async (req, res) => {
  try {
    const user = await db.collection("users").findOne({ uid: req.user.uid });
    res.json({ success: true, user });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ success: false, message: "Error fetching user" });
  }
});

// ===== SEED DATA =====
const seedData = async () => {
  try {
    const courseCount = await db.collection("courses").countDocuments();
    if (courseCount === 0) {
      console.log("Seeding sample courses to MongoDB Atlas...");

      //

      await db.collection("courses").insertMany(sampleCourses);
      console.log("Sample courses added to MongoDB Atlas!");
    }
  } catch (error) {
    console.error("Error seeding data:", error);
  }
};

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Something went wrong!" });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ success: false, message: "API route not found" });
});

const PORT = process.env.PORT || 5000;

// Start server connect to MongoDB
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API Health: http://localhost:${PORT}/api/health`);
  await connectDB();
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  // await client.close();
  process.exit(0);
});
