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
        filename: path.join(__dirname, 'database.sqlite'),
        driver: sqlite3.Database
    });
    await db.exec('PRAGMA foreign_keys = ON;');
    console.log("Connected to the SQLite database (foreign keys enabled).");
})();

app.get('/', (req, res) => {
    res.send('Club Portal API is running!');
});

// ==================== MIDDLEWARE ====================

const requireAuth = (req, res, next) => {
    const userId = req.cookies.userId;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: Please log in' });
    }
    req.userId = userId;
    req.userRole = req.cookies.userRole;
    next();
};

// Leaders AND chief_leads pass this gate
const requireLeader = (req, res, next) => {
    if (req.userRole !== 'leader' && req.userRole !== 'chief_lead') {
        return res.status(403).json({ error: 'Forbidden: Requires leader role' });
    }
    next();
};

// Only chief_leads pass this gate
const requireChiefLead = (req, res, next) => {
    if (req.userRole !== 'chief_lead') {
        return res.status(403).json({ error: 'Forbidden: Requires chief lead role' });
    }
    next();
};

// ==================== AUTH ====================

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    try {
        const user = await db.get('SELECT * FROM Users WHERE username = ?', [username]);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        res.cookie('userId', user.id, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        res.cookie('userRole', user.role, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        res.json({ message: 'Login successful', role: user.role });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== WORKSPACE: GET OWN JOBS ====================
// Returns individual jobs assigned to user + team jobs for teams user belongs to
app.get('/api/jobs', requireAuth, async (req, res) => {
    try {
        const jobs = await db.all(`
            SELECT * FROM Jobs 
            WHERE assigned_to_user_id = ? 
            OR team_id IN (SELECT team_id FROM Team_Members WHERE user_id = ?)
        `, [req.userId, req.userId]);
        res.json({ jobs });
    } catch (error) {
        console.error("Error fetching jobs:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== WORKSPACE: LEADER/CHIEF VIEW ALL USERS + JOBS ====================
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

// ==================== ASSIGN INDIVIDUAL OBJECTIVE ====================
// Chief Leads: Can assign to leaders and members (NOT other chief_leads)
// Leaders: Can assign to members only (NOT leaders or chief_leads)  
app.post('/api/admin/jobs', requireAuth, requireLeader, async (req, res) => {
    const { title, description, assigned_to_user_id } = req.body;
    
    if (!title || !assigned_to_user_id) {
        return res.status(400).json({ error: 'Title and assigned_to_user_id are required' });
    }

    try {
        const targetUser = await db.get('SELECT id, role FROM Users WHERE id = ?', [assigned_to_user_id]);
        if (!targetUser) {
            return res.status(404).json({ error: 'Assigned user not found' });
        }

        // Chief leads can assign to leaders + members, but NOT chief_leads
        if (req.userRole === 'chief_lead') {
            if (targetUser.role === 'chief_lead') {
                return res.status(403).json({ error: 'Cannot assign objectives to other Chief Leads.' });
            }
        }
        // Leaders can only assign to members
        if (req.userRole === 'leader') {
            if (targetUser.role !== 'member') {
                return res.status(403).json({ error: 'Leaders can only assign objectives to members.' });
            }
        }

        const result = await db.run(
            'INSERT INTO Jobs (title, description, assigned_to_user_id, created_by) VALUES (?, ?, ?, ?)',
            [title, description, assigned_to_user_id, req.userId]
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

// ==================== SUBMIT PROOF ====================
// Any user who has the job (individual or team) can submit proof
app.post('/api/jobs/:id/submit', requireAuth, upload.single('proofImage'), async (req, res) => {
    const jobId = req.params.id;
    try {
        const job = await db.get(`
            SELECT * FROM Jobs 
            WHERE id = ? AND (
                assigned_to_user_id = ? OR 
                team_id IN (SELECT team_id FROM Team_Members WHERE user_id = ?)
            )
        `, [jobId, req.userId, req.userId]);
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

// ==================== REVIEW: ACCEPT (ARCHIVE) ====================
// Chief Leads: Can accept ANY objective (individual or team)
// Leaders: Can accept team objectives only for teams they lead
// Individual objective creators: Can accept objectives they personally created
app.post('/api/admin/jobs/:id/accept', requireAuth, async (req, res) => {
    const jobId = req.params.id;
    try {
        const job = await db.get('SELECT * FROM Jobs WHERE id = ?', [jobId]);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        // Chief leads can review everything
        if (req.userRole === 'chief_lead') {
            await db.run("UPDATE Jobs SET status = 'archived' WHERE id = ?", [jobId]);
            return res.json({ message: 'Objective accepted and archived' });
        }

        // The creator of the objective can review it
        if (String(job.created_by) === String(req.userId)) {
            await db.run("UPDATE Jobs SET status = 'archived' WHERE id = ?", [jobId]);
            return res.json({ message: 'Objective accepted and archived' });
        }

        // Leaders can review team objectives for teams they lead
        if (req.userRole === 'leader' && job.team_id) {
            const membership = await db.get(
                "SELECT * FROM Team_Members WHERE team_id = ? AND user_id = ? AND role_in_team = 'leader'",
                [job.team_id, req.userId]
            );
            if (membership) {
                await db.run("UPDATE Jobs SET status = 'archived' WHERE id = ?", [jobId]);
                return res.json({ message: 'Objective accepted and archived' });
            }
        }

        return res.status(403).json({ error: 'You do not have permission to review this objective.' });
    } catch (error) {
        console.error("Error accepting job:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== REVIEW: REJECT (PUSH BACK TO ACTIVE) ====================
// Same permission rules as accept
app.post('/api/admin/jobs/:id/reject', requireAuth, async (req, res) => {
    const jobId = req.params.id;
    try {
        const job = await db.get('SELECT * FROM Jobs WHERE id = ?', [jobId]);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        // Chief leads can review everything
        if (req.userRole === 'chief_lead') {
            await db.run("UPDATE Jobs SET status = 'active', proof_image_url = NULL WHERE id = ?", [jobId]);
            return res.json({ message: 'Objective rejected and pushed back to active' });
        }

        // The creator of the objective can review it
        if (String(job.created_by) === String(req.userId)) {
            await db.run("UPDATE Jobs SET status = 'active', proof_image_url = NULL WHERE id = ?", [jobId]);
            return res.json({ message: 'Objective rejected and pushed back to active' });
        }

        // Leaders can review team objectives for teams they lead
        if (req.userRole === 'leader' && job.team_id) {
            const membership = await db.get(
                "SELECT * FROM Team_Members WHERE team_id = ? AND user_id = ? AND role_in_team = 'leader'",
                [job.team_id, req.userId]
            );
            if (membership) {
                await db.run("UPDATE Jobs SET status = 'active', proof_image_url = NULL WHERE id = ?", [jobId]);
                return res.json({ message: 'Objective rejected and pushed back to active' });
            }
        }

        return res.status(403).json({ error: 'You do not have permission to review this objective.' });
    } catch (error) {
        console.error("Error rejecting job:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== DELETE OBJECTIVE ====================
// Only the creator of the objective can delete it
app.delete('/api/jobs/:id', requireAuth, async (req, res) => {
    const jobId = req.params.id;
    try {
        const job = await db.get('SELECT * FROM Jobs WHERE id = ?', [jobId]);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        if (String(job.created_by) !== String(req.userId)) {
            return res.status(403).json({ error: 'Only the publisher of this objective can delete it.' });
        }

        await db.run("DELETE FROM Jobs WHERE id = ?", [jobId]);
        res.json({ message: 'Objective deleted' });
    } catch (error) {
        console.error("Error deleting job:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== CHIEF LEAD: USER MANAGEMENT ====================

app.get('/api/users', requireAuth, requireChiefLead, async (req, res) => {
    try {
        const users = await db.all('SELECT id, username, role FROM Users');
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching users' });
    }
});

app.post('/api/users', requireAuth, requireChiefLead, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });
    try {
        if (role === 'chief_lead') {
            const countRow = await db.get("SELECT COUNT(*) as count FROM Users WHERE role = 'chief_lead'");
            if (countRow.count >= 3) return res.status(403).json({ error: 'Maximum limit of 3 chief leads reached.' });
        }
        const hash = await bcrypt.hash(password, 10);
        await db.run("INSERT INTO Users (username, password_hash, role) VALUES (?, ?, ?)", [username, hash, role]);
        res.status(201).json({ message: 'User created' });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint')) return res.status(400).json({ error: 'Username taken' });
        res.status(500).json({ error: 'Error creating user' });
    }
});

app.delete('/api/users/:id', requireAuth, requireChiefLead, async (req, res) => {
    try {
        await db.run("DELETE FROM Users WHERE id = ?", [req.params.id]);
        res.json({ message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Error deleting user' });
    }
});

// ==================== CHIEF LEAD: TEAM MANAGEMENT ====================
// Chief leads create teams and assign members/leaders to them
// They do NOT post team jobs or events (that's leader territory)

app.get('/api/teams', requireAuth, requireChiefLead, async (req, res) => {
    try {
        const teams = await db.all('SELECT * FROM Teams');
        for (let team of teams) {
            team.members = await db.all(`
                SELECT u.id, u.username, tm.role_in_team, u.role
                FROM Users u
                JOIN Team_Members tm ON u.id = tm.user_id
                WHERE tm.team_id = ?
            `, [team.id]);
        }
        res.json({ teams });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching teams' });
    }
});

app.post('/api/teams', requireAuth, requireChiefLead, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name required' });
    try {
        const result = await db.run("INSERT INTO Teams (name, created_by) VALUES (?, ?)", [name, req.userId]);
        res.status(201).json({ message: 'Team created', teamId: result.lastID });
    } catch (err) {
        res.status(500).json({ error: 'Error creating team' });
    }
});

// Chief leads can assign anyone (leader or member) to a team
app.post('/api/teams/:id/members', requireAuth, requireChiefLead, async (req, res) => {
    const { user_id, role_in_team } = req.body;
    try {
        await db.run("INSERT INTO Team_Members (team_id, user_id, role_in_team) VALUES (?, ?, ?)", [req.params.id, user_id, role_in_team]);
        res.status(201).json({ message: 'Member added' });
    } catch (err) {
        res.status(500).json({ error: 'Error assigning member' });
    }
});

// ==================== LEADER: ADD MEMBERS TO THEIR TEAMS ====================
// Leaders can add MEMBERS (not leaders) to teams they lead
app.post('/api/leader/teams/:id/members', requireAuth, async (req, res) => {
    const { user_id } = req.body;
    try {
        // Verify the requester is a leader in this team
        const membership = await db.get(
            "SELECT * FROM Team_Members WHERE team_id = ? AND user_id = ? AND role_in_team = 'leader'",
            [req.params.id, req.userId]
        );
        if (!membership) return res.status(403).json({ error: 'You are not a leader in this team.' });

        // Verify target user is a member role (not leader/chief_lead)
        const targetUser = await db.get('SELECT role FROM Users WHERE id = ?', [user_id]);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        if (targetUser.role !== 'member') return res.status(403).json({ error: 'Leaders can only add members to teams, not other leaders.' });

        await db.run("INSERT INTO Team_Members (team_id, user_id, role_in_team) VALUES (?, ?, 'member')", [req.params.id, user_id]);
        res.status(201).json({ message: 'Member added to team' });
    } catch (err) {
        res.status(500).json({ error: 'Error adding member' });
    }
});

// ==================== LEADER: TEAM JOBS & EVENTS ====================
// Only leaders (in team) can post team jobs and events. NOT chief leads.
app.post('/api/admin/teams/:id/jobs', requireAuth, async (req, res) => {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    try {
        // Verify the requester is a leader in this specific team
        const membership = await db.get(
            "SELECT * FROM Team_Members WHERE team_id = ? AND user_id = ? AND role_in_team = 'leader'",
            [req.params.id, req.userId]
        );
        if (!membership) return res.status(403).json({ error: 'You must be a leader of this team to post team objectives.' });

        const result = await db.run(
            "INSERT INTO Jobs (title, description, team_id, created_by) VALUES (?, ?, ?, ?)", 
            [title, description, req.params.id, req.userId]
        );
        res.status(201).json({ message: 'Team job posted', jobId: result.lastID });
    } catch (err) {
        res.status(500).json({ error: 'Error posting team job' });
    }
});

app.post('/api/admin/teams/:id/events', requireAuth, async (req, res) => {
    const { title, start_date, end_date } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    try {
        // Verify the requester is a leader in this specific team
        const membership = await db.get(
            "SELECT * FROM Team_Members WHERE team_id = ? AND user_id = ? AND role_in_team = 'leader'",
            [req.params.id, req.userId]
        );
        if (!membership) return res.status(403).json({ error: 'You must be a leader of this team to add events.' });

        await db.run("INSERT INTO Team_Events (team_id, title, start_date, end_date) VALUES (?, ?, ?, ?)", [req.params.id, title, start_date, end_date]);
        res.status(201).json({ message: 'Team event created' });
    } catch (err) {
        res.status(500).json({ error: 'Error creating event' });
    }
});

// ==================== ALL USERS: MY TEAMS ====================
app.get('/api/teams/my-teams', requireAuth, async (req, res) => {
    try {
        const teams = await db.all(`
            SELECT t.id, t.name, tm.role_in_team 
            FROM Teams t
            JOIN Team_Members tm ON t.id = tm.team_id
            WHERE tm.user_id = ?
        `, [req.userId]);
        for (let team of teams) {
            team.jobs = await db.all("SELECT * FROM Jobs WHERE team_id = ?", [team.id]);
            team.events = await db.all("SELECT * FROM Team_Events WHERE team_id = ?", [team.id]);
            team.members = await db.all(`
                SELECT u.id, u.username, tm.role_in_team, u.role
                FROM Users u
                JOIN Team_Members tm ON u.id = tm.user_id
                WHERE tm.team_id = ?
            `, [team.id]);
        }
        res.json({ teams });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching team data' });
    }
});

// ==================== GET NON-CHIEF USERS (for leader member-add dropdown) ====================
app.get('/api/members-list', requireAuth, async (req, res) => {
    try {
        const members = await db.all("SELECT id, username, role FROM Users WHERE role = 'member'");
        res.json({ members });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching members' });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
