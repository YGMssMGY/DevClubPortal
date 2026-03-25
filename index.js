const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

let db;
(async () => {
    db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });
    console.log("Connected to the SQLite database.");
})();

app.get('/', (req, res) => {
    res.send('Club Portal API is running!');
});

// Middleware to require authentication
const requireAuth = (req, res, next) => {
    const userId = req.cookies.userId;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: Please log in' });
    }
    req.userId = userId;
    req.userRole = req.cookies.userRole;
    next();
};

// Middleware to require leader role
const requireLeader = (req, res, next) => {
    if (req.userRole !== 'leader') {
        return res.status(403).json({ error: 'Forbidden: Requires leader role' });
    }
    next();
};

// Login Route
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const user = await db.get('SELECT * FROM Users WHERE username = ?', [username]);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Set secure, HTTP-only cookie
        res.cookie('userId', user.id, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        res.cookie('userRole', user.role, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

        res.json({ message: 'Login successful', role: user.role });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 1. GET member's own jobs
app.get('/api/jobs', requireAuth, async (req, res) => {
    try {
        const jobs = await db.all('SELECT * FROM Jobs WHERE assigned_to_user_id = ?', [req.userId]);
        res.json({ jobs });
    } catch (error) {
        console.error("Error fetching jobs:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2. GET all users and their respective jobs (Leader only)
app.get('/api/admin/users', requireAuth, requireLeader, async (req, res) => {
    try {
        const users = await db.all('SELECT id, username, role FROM Users');
        const jobs = await db.all('SELECT * FROM Jobs');
        
        const usersWithJobs = users.map(user => ({
            ...user,
            jobs: jobs.filter(job => job.assigned_to_user_id === user.id)
        }));

        res.json({ users: usersWithJobs });
    } catch (error) {
        console.error("Error fetching all users and jobs:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 3. POST a new job (Leader only)
app.post('/api/admin/jobs', requireAuth, requireLeader, async (req, res) => {
    const { title, description, assigned_to_user_id } = req.body;
    
    if (!title || !assigned_to_user_id) {
        return res.status(400).json({ error: 'Title and assigned_to_user_id are required' });
    }

    try {
        const user = await db.get('SELECT id FROM Users WHERE id = ?', [assigned_to_user_id]);
        if (!user) {
            return res.status(404).json({ error: 'Assigned user not found' });
        }

        const result = await db.run(
            'INSERT INTO Jobs (title, description, assigned_to_user_id) VALUES (?, ?, ?)',
            [title, description, assigned_to_user_id]
        );
        
        res.status(201).json({ 
            message: 'Job created successfully',
            jobId: result.lastID 
        });
    } catch (error) {
        console.error("Error creating job:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Submit job proof (Member only)
app.post('/api/jobs/:id/submit', requireAuth, upload.single('proofImage'), async (req, res) => {
    const jobId = req.params.id;
    try {
        const job = await db.get('SELECT * FROM Jobs WHERE id = ? AND assigned_to_user_id = ?', [jobId, req.userId]);
        if (!job) return res.status(404).json({ error: 'Job not found or not assigned to you' });
        if (!req.file) return res.status(400).json({ error: 'Proof image is required' });

        const proofUrl = '/uploads/' + req.file.filename;
        await db.run("UPDATE Jobs SET status = 'submitted', proof_image_url = ? WHERE id = ?", [proofUrl, jobId]);
        res.json({ message: 'Job submitted successfully', proofUrl });
    } catch (error) {
        console.error("Error submitting job:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Archive job (Leader only)
app.post('/api/admin/jobs/:id/archive', requireAuth, requireLeader, async (req, res) => {
    const jobId = req.params.id;
    try {
        const job = await db.get('SELECT * FROM Jobs WHERE id = ?', [jobId]);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        await db.run("UPDATE Jobs SET status = 'archived' WHERE id = ?", [jobId]);
        res.json({ message: 'Job archived successfully' });
    } catch (error) {
        console.error("Error archiving job:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
