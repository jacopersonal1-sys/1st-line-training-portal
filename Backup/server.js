const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto'); // NEW: For server-side hashing

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

// ==========================================
// IN-MEMORY ACTIVE USER TRACKING
// ==========================================
// Stores user sessions to track who is online and their idle status.
// This data is ephemeral (resets on server restart).
let activeSessions = {}; 

// Middleware
app.use(cors());
// Increased limit to 50mb to handle Base64 images in Test Builder
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(express.static(__dirname)); // Serve static files (index.html, css, js)

// Ensure backup directory exists on start
if (!fs.existsSync(BACKUP_DIR)) {
    try {
        fs.mkdirSync(BACKUP_DIR);
        console.log("Created backup directory.");
    } catch (err) {
        console.error("Could not create backup directory:", err);
    }
}

/* ================= API ENDPOINTS ================= */

// 1. GET Database
// Called by data.js -> loadFromServer()
app.get('/api/database', (req, res) => {
    if (fs.existsSync(DB_FILE)) {
        fs.readFile(DB_FILE, 'utf8', (err, data) => {
            if (err) {
                console.error("Read Error:", err);
                return res.status(500).json({ error: "Failed to read database" });
            }
            try {
                // Return parsed JSON
                res.json(JSON.parse(data));
            } catch (e) {
                console.warn("Database file corrupted or empty. Returning empty object.");
                res.json({}); 
            }
        });
    } else {
        // No database yet (First run), return empty
        res.json({}); 
    }
});

// 2. POST Save (With Backup Rotation)
// Called by data.js -> saveToServer()
app.post('/api/save', (req, res) => {
    const data = req.body;
    
    // A. PERFORM BACKUP
    if (fs.existsSync(DB_FILE)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(BACKUP_DIR, `database_backup_${timestamp}.json`);
        
        try {
            fs.copyFileSync(DB_FILE, backupPath);
            
            // Optional: Cleanup old backups (Keep last 20)
            fs.readdir(BACKUP_DIR, (err, files) => {
                if(!err && files.length > 20) {
                    // Sort by time (name) and delete oldest
                    files.sort(); 
                    const filesToDelete = files.slice(0, files.length - 20);
                    filesToDelete.forEach(f => fs.unlink(path.join(BACKUP_DIR, f), () => {}));
                }
            });
            
        } catch (err) {
            console.error("Backup failed (proceeding with save anyway):", err);
        }
    }

    // B. SAVE NEW DATA
    fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), (err) => {
        if (err) {
            console.error("Write Error:", err);
            return res.status(500).json({ status: 'error', message: "Failed to write to disk" });
        }
        res.json({ status: 'success' });
    });
});

// 3. NEW: System Status & Active Users
// Used by Admin Dashboard to show storage, latency check, and online users
app.get('/api/status', (req, res) => {
    // A. Calculate Storage Used (Database File Size)
    let storageSize = 0;
    if (fs.existsSync(DB_FILE)) {
        const stats = fs.statSync(DB_FILE);
        storageSize = stats.size; // bytes
    }

    // B. Clean up stale sessions (older than 2 minutes)
    const now = Date.now();
    const TIMEOUT = 2 * 60 * 1000; // 2 minutes
    
    Object.keys(activeSessions).forEach(username => {
        if ((now - activeSessions[username].lastSeen) > TIMEOUT) {
            delete activeSessions[username];
        }
    });

    res.json({
        storageUsed: storageSize,
        activeUsers: activeSessions, // Returns object of active users
        serverTime: now // Used for latency calculation on client
    });
});

// 4. NEW: Heartbeat
// Clients call this every ~30s to report they are online and their idle status
app.post('/api/heartbeat', (req, res) => {
    const { user, role, idleTime, isIdle } = req.body;

    if (user) {
        activeSessions[user] = {
            user,
            role,
            idleTime: idleTime || 0,
            isIdle: isIdle || false,
            lastSeen: Date.now()
        };
    }
    
    res.json({ status: 'ok' });
});

// 5. NEW: Factory Reset
// Clears the database and restores default Admin user
app.post('/api/factory-reset', (req, res) => {
    // A. PERFORM SAFETY BACKUP FIRST
    if (fs.existsSync(DB_FILE)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(BACKUP_DIR, `PRE_RESET_backup_${timestamp}.json`);
        try {
            fs.copyFileSync(DB_FILE, backupPath);
            console.log("Safety backup created before reset:", backupPath);
        } catch (err) {
            console.error("Reset Backup failed:", err);
            return res.status(500).json({ status: 'error', message: "Backup failed. Reset aborted for safety." });
        }
    }

    // B. DEFINE FACTORY DEFAULT STATE
    // This ensures the Admin user still exists so you aren't locked out.
    
    // NEW: Generate Hash for default password "Pass0525@"
    const defaultPassHash = crypto.createHash('sha256').update("Pass0525@").digest('hex');

    const defaultData = {
        users: [
            {
                pass: defaultPassHash, // Store Hash, not Plaintext
                role: "admin",
                user: "admin",
                theme: {
                    primaryColor: "#1fb4f4",
                    wallpaper: "https://images.wallpaperscraft.com/image/single/smoke_abstraction_particles_118225_2560x1440.jpg"
                }
            }
        ],
        records: [],
        assessments: [],
        rosters: {},
        accessControl: {
            enabled: false,
            whitelist: []
        },
        trainingData: {},
        vettingTopics: [],
        schedules: {},
        liveBookings: [],
        cancellationCounts: {},
        liveScheduleSettings: {
            startDate: new Date().toISOString().split('T')[0],
            days: 7
        },
        tests: [],
        submissions: [],
        savedReports: [],
        insightReviews: [],
        exemptions: [],
        notices: []
    };

    // C. WRITE DEFAULT DATA
    fs.writeFile(DB_FILE, JSON.stringify(defaultData, null, 2), (err) => {
        if (err) {
            console.error("Reset Write Error:", err);
            return res.status(500).json({ status: 'error', message: "Failed to reset database file." });
        }
        
        // D. Clear Active Sessions
        activeSessions = {};
        
        console.log("Database has been reset to factory settings.");
        res.json({ status: 'success', message: "System reset successful." });
    });
});

/* ================= FALLBACK ================= */

// Handle any other requests by serving index.html (SPA support)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`--------------------------------------------------`);
    console.log(`1st Line Training Portal Running`);
    console.log(`► Local:   http://localhost:${PORT}`);
    console.log(`► Data:    ${DB_FILE}`);
    console.log(`--------------------------------------------------`);
});