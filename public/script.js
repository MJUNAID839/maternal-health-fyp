// ========== MATERNAI - MAIN APPLICATION ==========

let currentUserRole = null;
let currentUserId = null;
let currentUserName = null;
let currentPatientId = null;
let monitorInterval = null;
let isMonitoring = false;
let currentPatientData = null;
let featureChart = null;
let currentRiskContributions = { pulse: 45, spo2: 35, temp: 20 };
let patientsList = []; // Store patients for quick lookup

// ========== REAL-TIME MONITORING VARIABLES ==========
let realtimeReadingCount = 0;
let realtimePulse = 0;
let realtimeSpO2 = 0;
let realtimeTemp = 0;
let realtimeRisk = 0;
let realtimePatientName = '';
let realtimePatientId = '';
let realtimeIntervalRunning = false;
let sensorDataInterval = null;
let readingsArray = []; // Store readings for average calculation
let maxReadings = 20; // Maximum 20 readings

// ========== CHATBOT VARIABLES ==========
let currentConversationId = null;
let isTyping = false;
let chatHistoryList = [];

// ========== DOCTOR REGISTRATION VARIABLES ==========
let docUsernameCheckTimeout = null;
let currentRole = 'doctor'; // Default role

// ========== STATIC DASHBOARD VALUES (Never Change) ==========
const STATIC_AVG_HR = '75 bpm';
const STATIC_AVG_SPO2 = '98%';
const STATIC_AVG_TEMP = '36.5°C';

// ========== AUTHENTICATION & ROLE SELECTION ==========

function selectRole(role) {
    currentRole = role;
    const btns = document.querySelectorAll('.role-btn');
    btns.forEach(btn => btn.classList.remove('active'));
    
    btns.forEach(btn => {
        if (btn.innerText.toLowerCase().includes(role)) {
            btn.classList.add('active');
        }
    });
    
    const roleActionText = document.getElementById('roleActionText');
    const demoCreds = document.getElementById('demoCreds');
    
    if (role === 'doctor') {
        roleActionText.innerHTML = '<span style="color: #7f8c8d;">Don\'t have an account? </span><a href="#" onclick="showDoctorRegisterModal()" style="color: #3498db; text-decoration: none; font-weight: 600;">Create Account</a>';
        if (demoCreds) demoCreds.style.display = 'block';
    } else {
        roleActionText.innerHTML = '<span style="color: #7f8c8d;">Use credentials provided by your doctor</span>';
        if (demoCreds) demoCreds.style.display = 'none';
    }
}

function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (!username || !password) {
        alert('Please enter username and password');
        return;
    }
    
    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            completeLogin(data.name, data.role, data.patient_id);
        } else {
            alert('Invalid credentials. Please check your username and password.');
        }
    })
    .catch(error => {
        console.error('Login error:', error);
        alert('Login failed. Please check if server is running.');
    });
}

// ========== DOCTOR REGISTRATION FUNCTIONS ==========

function showDoctorRegisterModal() {
    const modal = document.getElementById('doctorRegisterModal');
    if (modal) modal.style.display = 'flex';
    
    const fields = ['docFullName', 'docEmail', 'docUsername', 'docPassword', 'docConfirmPassword'];
    fields.forEach(field => {
        const el = document.getElementById(field);
        if (el) el.value = '';
    });
    
    const statusSpan = document.getElementById('docUsernameStatus');
    if (statusSpan) statusSpan.style.display = 'none';
}

function closeDoctorRegisterModal() {
    const modal = document.getElementById('doctorRegisterModal');
    if (modal) modal.style.display = 'none';
}

const usernameCheckInput = document.getElementById('docUsername');
if (usernameCheckInput) {
    usernameCheckInput.addEventListener('input', function() {
        const username = this.value;
        const statusSpan = document.getElementById('docUsernameStatus');
        
        if (username.length < 3) {
            if (statusSpan) statusSpan.style.display = 'none';
            return;
        }
        
        if (docUsernameCheckTimeout) clearTimeout(docUsernameCheckTimeout);
        
        docUsernameCheckTimeout = setTimeout(() => {
            fetch('/api/check_username', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ username: username })
            })
            .then(response => response.json())
            .then(data => {
                if (statusSpan) {
                    statusSpan.style.display = 'block';
                    const isTaken = data.exists === true || data.available === false;
                    if (isTaken) {
                        statusSpan.innerHTML = '❌ Username already taken';
                        statusSpan.style.color = '#e74c3c';
                    } else {
                        statusSpan.innerHTML = '✅ Username available';
                        statusSpan.style.color = '#27ae60';
                    }
                }
            })
            .catch(error => {
                console.error('Username check error:', error);
                if (statusSpan) {
                    statusSpan.style.display = 'none';
                }
            });
        }, 500);
    });
}

function registerDoctorAccount() {
    const fullName = document.getElementById('docFullName')?.value.trim() || '';
    const email = document.getElementById('docEmail')?.value.trim() || '';
    const username = document.getElementById('docUsername')?.value.trim() || '';
    const password = document.getElementById('docPassword')?.value || '';
    const confirmPassword = document.getElementById('docConfirmPassword')?.value || '';
    
    if (!fullName || !username || !password) {
        alert('❌ Please fill all required fields');
        return;
    }
    
    if (password !== confirmPassword) {
        alert('❌ Passwords do not match');
        return;
    }
    
    if (password.length < 4) {
        alert('❌ Password must be at least 4 characters');
        return;
    }
    
    const registerBtn = document.querySelector('#doctorRegisterModal .btn-primary');
    const originalText = registerBtn ? registerBtn.innerHTML : 'Create Account';
    if (registerBtn) {
        registerBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Creating...';
        registerBtn.disabled = true;
    }
    
    console.log('📤 Sending registration request...', { name: fullName, username, email });
    
    fetch('/api/register_doctor', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            name: fullName,
            email: email,
            username: username,
            password: password
        })
    })
    .then(async response => {
        console.log('📥 Response status:', response.status);
        const data = await response.json();
        console.log('📥 Response data:', data);
        
        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        return data;
    })
    .then(data => {
        console.log('✅ Registration successful:', data);
        
        if (data.success === true) {
            alert(`✅ ACCOUNT CREATED SUCCESSFULLY!\n\nUsername: ${username}\nName: ${fullName}\n\nYou can now login with your credentials.`);
            closeDoctorRegisterModal();
            
            const fields = ['docFullName', 'docEmail', 'docUsername', 'docPassword', 'docConfirmPassword'];
            fields.forEach(field => {
                const el = document.getElementById(field);
                if (el) el.value = '';
            });
            
            const usernameField = document.getElementById('username');
            if (usernameField) usernameField.value = username;
            
            const passwordField = document.getElementById('password');
            if (passwordField) passwordField.value = '';
            
            if (currentRole !== 'doctor') {
                const doctorBtn = document.querySelector('.role-btn:first-child');
                if (doctorBtn) doctorBtn.click();
            }
            
            console.log('🎉 Registration complete, ready for login');
        } else {
            throw new Error(data.error || 'Registration failed - unknown error');
        }
    })
    .catch(error => {
        console.error('❌ Registration error:', error);
        
        let errorMsg = error.message;
        if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
            errorMsg = 'Cannot connect to server. Please check if the server is running on port 5050.';
        } else if (errorMsg.includes('Username already')) {
            errorMsg = 'Username already taken. Please choose another username.';
        }
        
        alert(`❌ Registration Failed!\n\n${errorMsg}\n\nPlease try again.`);
    })
    .finally(() => {
        if (registerBtn) {
            registerBtn.innerHTML = originalText;
            registerBtn.disabled = false;
        }
    });
}

// ========== RESTRICT PATIENT VIEW ==========

function restrictPatientView() {
    if (currentUserRole !== 'patient') return;
    
    // Add 'xai' to the allowed pages for patients
    const allowedPages = ['dashboard', 'records', 'assistant', 'xai'];  // Added 'xai'
    
    document.querySelectorAll('.menu-link').forEach(link => {
        const page = link.getAttribute('data-page');
        if (!allowedPages.includes(page)) {
            link.style.display = 'none';
        } else {
            link.style.display = 'flex';
        }
    });
    
    const currentActivePage = document.querySelector('.page-content.active');
    const currentPageId = currentActivePage ? currentActivePage.id : 'dashboardPageContent';
    const pageName = currentPageId.replace('PageContent', '');
    
    if (!allowedPages.includes(pageName)) {
        const dashboardLink = document.querySelector('.menu-link[data-page="dashboard"]');
        if (dashboardLink) dashboardLink.click();
    }
}

function customizePatientManualCheck() {
    if (currentUserRole !== 'patient') return;
    
    const manualForm = document.querySelector('#manualPageContent .manual-form');
    if (manualForm) {
        manualForm.style.display = 'none';
    }
    
    const manualPage = document.getElementById('manualPageContent');
    if (manualPage && !manualPage.querySelector('.patient-info-message')) {
        const message = document.createElement('div');
        message.className = 'info-card patient-info-message';
        message.innerHTML = `
            <div class="card-title">
                <i class="bi bi-info-circle"></i> Information
            </div>
            <div class="card-content">
                <p>As a patient, you can view your health records but cannot add new assessments. 
                Please contact your healthcare provider for manual checkups.</p>
                <p style="margin-top: 10px;"><strong>Your records:</strong> <span id="patientRecordCount">0</span> total assessments</p>
            </div>
        `;
        manualPage.appendChild(message);
    }
}

function restoreDoctorManualCheck() {
    if (currentUserRole !== 'doctor') return;
    
    const manualForm = document.querySelector('#manualPageContent .manual-form');
    if (manualForm) {
        manualForm.style.display = 'block';
        manualForm.style.opacity = '1';
        manualForm.style.pointerEvents = 'auto';
        const calculateBtn = manualForm.querySelector('.btn-primary');
        if (calculateBtn) calculateBtn.disabled = false;
    }
    
    const patientMessage = document.querySelector('#manualPageContent .patient-info-message');
    if (patientMessage) {
        patientMessage.remove();
    }
    
    const monitorForm = document.querySelector('#monitorPageContent .monitor-form');
    if (monitorForm) {
        monitorForm.style.display = 'block';
        monitorForm.style.opacity = '1';
        monitorForm.style.pointerEvents = 'auto';
        const startBtn = monitorForm.querySelector('.btn-primary');
        if (startBtn) startBtn.disabled = false;
    }
}

function updatePatientRecordCount(count) {
    const countSpan = document.querySelector('#manualPageContent .patient-info-message #patientRecordCount');
    if (countSpan) {
        countSpan.textContent = count;
    }
}

function completeLogin(name, role, patientId) {
    currentUserRole = role;
    currentUserName = name;
    currentPatientId = patientId;
    currentUserId = patientId;
    
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('dashboardPage').style.display = 'block';
    document.getElementById('welcomeUserName').innerHTML = name;
    
    const now = new Date();
    document.getElementById('currentDateDisplay').innerHTML = now.toLocaleDateString('en-US', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });
    
    const managePatientsMenu = document.getElementById('managePatientsMenu');
    const clearAllBtn = document.getElementById('clearAllBtn');
    
    if (role === 'doctor') {
        if (managePatientsMenu) managePatientsMenu.style.display = 'flex';
        if (clearAllBtn) clearAllBtn.style.display = 'inline-block';
        loadPatientList();
        
        document.querySelectorAll('.menu-link').forEach(link => {
            link.style.display = 'flex';
        });
        
        restoreDoctorManualCheck();
        
        const patientNameField = document.getElementById('patientName');
        const patientIdField = document.getElementById('patientId');
        if (patientNameField) {
            patientNameField.value = '';
            patientNameField.readOnly = false;
            patientNameField.placeholder = 'Patient Name';
        }
        if (patientIdField) {
            patientIdField.value = '';
            patientIdField.readOnly = false;
            patientIdField.placeholder = 'Patient ID';
        }
    } else {
        if (managePatientsMenu) managePatientsMenu.style.display = 'none';
        if (clearAllBtn) clearAllBtn.style.display = 'none';
        
        restrictPatientView();
        customizePatientManualCheck();
        
        const patientNameField = document.getElementById('patientName');
        const patientIdField = document.getElementById('patientId');
        if (patientNameField) {
            patientNameField.value = name;
            patientNameField.readOnly = true;
        }
        if (patientIdField) {
            patientIdField.value = patientId;
            patientIdField.readOnly = true;
        }
    }
    
    // Load dashboard data but DO NOT update average vitals (keep static)
    loadDashboardStatsOnly();
    loadRecords();
    setupNavigation();
    initFeatureChart();
    loadChatHistory();
}
// ========== LOGOUT FUNCTION ==========

function logout() {
    console.log("Logging out...");
    
    // Stop real-time monitoring if active
    if (sensorDataInterval) {
        clearInterval(sensorDataInterval);
        sensorDataInterval = null;
    }
    
    if (realtimeIntervalRunning) {
        fetch('/api/stop_monitoring', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).catch(err => console.log("Stop monitoring error:", err));
    }
    
    // Clear any monitoring intervals
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
    
    // Call backend logout
    fetch('/api/logout', { method: 'POST' })
        .then(() => {
            console.log("Backend logout successful");
        })
        .catch(err => console.log("Logout error:", err));
    
    // Reset all global variables
    currentUserRole = null;
    currentUserName = null;
    currentPatientId = null;
    currentUserId = null;
    currentConversationId = null;
    realtimeIntervalRunning = false;
    currentPatientData = null;
    readingsArray = [];
    realtimeReadingCount = 0;
    
    // Hide dashboard, show login page
    const dashboardPage = document.getElementById('dashboardPage');
    const loginPage = document.getElementById('loginPage');
    
    if (dashboardPage) dashboardPage.style.display = 'none';
    if (loginPage) loginPage.style.display = 'flex';
    
    // Clear login form fields
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    
    // Optional: Show success message
    alert("Logged out successfully!");
    
    console.log("Logout complete");
}

// ========== NEW FUNCTION: Load only total and high risk stats (NOT average vitals) ==========
function loadDashboardStatsOnly() {
    fetch('/api/stats')
        .then(response => response.json())
        .then(stats => {
            // Update only total and high risk counts
            document.getElementById('statTotal').innerText = stats.total;
            document.getElementById('statHighRisk').innerText = stats.high_risk;
            document.getElementById('statPredictions').innerText = stats.total;
            
            // Average vitals remain STATIC - never updated from API
            // They keep the HTML default values: 75 bpm, 98%, 36.5°C
        })
        .catch(error => console.error('Error loading stats:', error));
}

// ========== ORIGINAL loadDashboardData (DISABLED - kept for reference but not used) ==========
// This function is intentionally DISABLED to prevent average vitals from updating
// The average vitals now remain static as defined in HTML
/*
function loadDashboardData() {
    fetch('/api/stats')
        .then(response => response.json())
        .then(stats => {
            document.getElementById('statTotal').innerText = stats.total;
            document.getElementById('statHighRisk').innerText = stats.high_risk;
            document.getElementById('statPredictions').innerText = stats.total;
            // These lines are REMOVED to keep average vitals static
            // document.getElementById('avgHR').innerHTML = stats.avg_pulse + ' bpm';
            // document.getElementById('avgSpO2').innerHTML = stats.avg_spo2 + '%';
            // document.getElementById('avgTemp').innerHTML = stats.avg_temp + '°C';
        })
        .catch(error => console.error('Error loading stats:', error));
}
*/

// ========== NAVIGATION ==========

function setupNavigation() {
    document.querySelectorAll('.menu-link').forEach(link => {
        const newLink = link.cloneNode(true);
        link.parentNode.replaceChild(newLink, link);
        
        newLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.menu-link').forEach(l => l.classList.remove('active'));
            newLink.classList.add('active');
            document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
            const targetPage = document.getElementById(newLink.dataset.page + 'PageContent');
            if (targetPage) targetPage.classList.add('active');
            
            if (newLink.dataset.page === 'feature') {
                setTimeout(() => {
                    initFeatureChart();
                    updateFeatureChartWithContributions();
                }, 100);
            }
            if (newLink.dataset.page === 'xai') {
                setTimeout(() => {
                    if (currentPatientData && currentPatientData.pulse && currentPatientData.pulse > 0) {
                        updateXAIExplanation(
                            currentPatientData.pulse, 
                            currentPatientData.spo2, 
                            currentPatientData.temp, 
                            currentPatientData.risk
                        );
                    } else {
                        updateXAIExplanation(0, 0, 0, 0);
                    }
                }, 100);
            }
            if (newLink.dataset.page === 'patients' && currentUserRole === 'doctor') {
                loadPatientList();
            }
            if (newLink.dataset.page === 'assistant') {
                setTimeout(() => loadChatHistory(), 100);
            }
        });
    });
}

// ========== FEATURE IMPORTANCE CHART ==========

function initFeatureChart() {
    const canvas = document.getElementById('featureChart');
    if (!canvas) return;
    
    if (featureChart) featureChart.destroy();
    
    featureChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Pulse Rate', 'Oxygen Saturation (SpO2)', 'Temperature'],
            datasets: [{
                label: 'Contribution to Risk Score (%)',
                data: [0, 0, 0],
                backgroundColor: ['#3498db', '#2ecc71', '#e74c3c'],
                borderRadius: 8,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { position: 'top' } },
            scales: {
                y: { beginAtZero: true, max: 100, title: { display: true, text: 'Contribution (%)' } }
            }
        }
    });
}

function updateFeatureChartWithContributions() {
    if (featureChart && currentRiskContributions) {
        featureChart.data.datasets[0].data = [currentRiskContributions.pulse, currentRiskContributions.spo2, currentRiskContributions.temp];
        featureChart.update();
    }
}

// ========== DASHBOARD DATA - ONLY TOTAL & HIGH RISK (AVERAGE VITALS STATIC) ==========

function loadDashboardStatsOnly() {
    fetch('/api/stats')
        .then(response => response.json())
        .then(stats => {
            document.getElementById('statTotal').innerText = stats.total;
            document.getElementById('statHighRisk').innerText = stats.high_risk;
            document.getElementById('statPredictions').innerText = stats.total;
            // Average vitals remain STATIC from HTML - never updated
        })
        .catch(error => console.error('Error loading stats:', error));
}

// Alias for compatibility
function loadDashboardData() {
    loadDashboardStatsOnly();
}

// ========== CALCULATE FEATURE CONTRIBUTIONS ==========

function calculateFeatureContributions(pulse, spo2, temp) {
    if (!pulse || isNaN(pulse) || pulse <= 0) return { pulse: 0, spo2: 0, temp: 0 };
    if (!spo2 || isNaN(spo2) || spo2 <= 0) return { pulse: 0, spo2: 0, temp: 0 };
    if (!temp || isNaN(temp) || temp <= 0) return { pulse: 0, spo2: 0, temp: 0 };
    
    const normalPulse = 75, normalSpo2 = 98, normalTemp = 36.5;
    const pulseDev = Math.abs(pulse - normalPulse);
    const spo2Dev = Math.abs(spo2 - normalSpo2) * 2;
    const tempDev = Math.abs(temp - normalTemp) * 10;
    const totalDev = pulseDev + spo2Dev + tempDev;
    
    if (totalDev === 0) return { pulse: 45, spo2: 35, temp: 20 };
    
    let pulseContrib = Math.round((pulseDev / totalDev) * 45);
    let spo2Contrib = Math.round((spo2Dev / totalDev) * 35);
    let tempContrib = Math.round((tempDev / totalDev) * 20);
    
    return { 
        pulse: Math.max(10, Math.min(80, pulseContrib)), 
        spo2: Math.max(10, Math.min(70, spo2Contrib)), 
        temp: Math.max(5, Math.min(50, tempContrib)) 
    };
}

// ========== XAI GUIDANCE - UPDATED VERSION ==========

// ========== AI RECOMMENDATIONS FUNCTION - FIXED FOR HIGH RISK (100%) ==========

function updateAIRecommendations(pulse, spo2, temp, riskScore) {
    const recommendationsDiv = document.getElementById('aiRecommendationsContent');
    if (!recommendationsDiv) return;
    
    const hasValidData = (pulse && !isNaN(pulse) && pulse > 0) && 
                         (spo2 && !isNaN(spo2) && spo2 > 0) && 
                         (temp && !isNaN(temp) && temp > 0);
    
    if (!hasValidData) {
        recommendationsDiv.innerHTML = `
            <div class="xai-placeholder">
                <i class="bi bi-robot" style="font-size: 48px; display: block; margin-bottom: 16px;"></i>
                <p>No vital signs data available yet.</p>
                <p style="font-size: 12px;">Use Manual Check or Real-time Monitor to generate recommendations.</p>
            </div>
        `;
        return;
    }
    
    // Generate recommendations based on risk level (same as PDF report)
    let recommendations = [];
    let riskLevel = '';
    let riskColor = '';
    
    // Properly handle all risk levels including 100%
    if (riskScore <= 30) {
        riskLevel = 'LOW RISK';
        riskColor = '#27ae60';
        recommendations = [
            '✅ Continue routine prenatal checkups as scheduled',
            '✅ Maintain healthy diet rich in folic acid, iron, and calcium',
            '✅ Stay hydrated - drink 8-10 glasses of water daily',
            '✅ Get adequate rest (7-9 hours of sleep)',
            '✅ Monitor for any developing symptoms',
            '📅 Schedule next assessment in 1 week'
        ];
    } else if (riskScore <= 60) {
        riskLevel = 'MEDIUM RISK';
        riskColor = '#f39c12';
        recommendations = [
            '⚠️ Increase monitoring frequency - check vitals every 4 hours',
            '⚠️ Schedule follow-up appointment within 48 hours',
            '⚠️ Reduce physical activity and stress levels',
            '⚠️ Monitor for worsening symptoms',
            '📞 Contact healthcare provider if symptoms change',
            '📊 Consider additional diagnostic tests'
        ];
    } else {
        // This catches ALL risk scores > 60 (including 70, 80, 90, 100)
        riskLevel = 'HIGH RISK';
        riskColor = '#e74c3c';
        recommendations = [
            '🔴 IMMEDIATE medical consultation required',
            '🔴 Continuous vital signs monitoring recommended',
            '🔴 Contact emergency services if symptoms worsen',
            '🔴 Avoid physical exertion and stress',
            '🔴 Do not delay seeking medical attention',
            '🏥 Prepare for possible hospital admission'
        ];
    }
    
    // Build the recommendations HTML
    let recommendationsHTML = `
        <div class="xai-risk-summary" style="background: ${riskColor}10; padding: 12px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid ${riskColor};">
            <h4 style="color: ${riskColor}; margin: 0 0 5px 0;">Risk Level: ${riskLevel} (${riskScore}%)</h4>
            <p style="margin: 0; font-size: 12px;">Based on AI analysis of vital signs using XGBoost model.</p>
        </div>
        
        <h4 style="margin: 0 0 15px 0;"><i class="bi bi-clipboard-heart"></i> Clinical Recommendations</h4>
        <ul style="list-style: none; padding: 0; margin: 0;">
    `;
    
    recommendations.forEach(rec => {
        recommendationsHTML += `<li style="margin-bottom: 12px; padding: 10px 14px; background: #f8f9fa; border-radius: 10px; border-left: 3px solid ${riskColor}; font-size: 14px; line-height: 1.5;">${rec}</li>`;
    });
    
    recommendationsHTML += `
        </ul>
        
        <div class="model-info" style="margin-top: 20px; padding: 12px; background: #e8f4f8; border-radius: 8px;">
            <p style="margin: 0; font-size: 12px; color: #2c7a6e;">
                <i class="bi bi-cpu"></i> 
                <strong>AI Model:</strong> XGBoost Classifier | <strong>Accuracy:</strong> 97.2%
            </p>
        </div>
        
        <div class="disclaimer-box" style="margin-top: 15px; padding: 10px; background: #fff3cd; border-radius: 8px; border-left: 3px solid #ffc107;">
            <p style="font-size: 11px; color: #856404; margin: 0;">
                ⚠️ <strong>Disclaimer:</strong> This is an AI-powered risk assessment. Always consult with a healthcare professional for medical decisions.
            </p>
        </div>
    `;
    
    recommendationsDiv.innerHTML = recommendationsHTML;
}

// ========== UPDATED XAI EXPLANATION FUNCTION ==========

function updateXAIExplanation(pulse, spo2, temp, riskScore) {
    const xaiContent = document.getElementById('xaiContent');
    if (!xaiContent) return;
    
    const hasValidData = (pulse && !isNaN(pulse) && pulse > 0) && 
                         (spo2 && !isNaN(spo2) && spo2 > 0) && 
                         (temp && !isNaN(temp) && temp > 0);
    
    if (!hasValidData) {
        xaiContent.innerHTML = `
            <div class="xai-placeholder">
                <i class="bi bi-graph-up" style="font-size: 48px; display: block; margin-bottom: 16px;"></i>
                <p>👈 Perform a Manual Check or start Real-time Monitoring to see AI explanations.</p>
                <p>The system will show you why a particular risk level was assigned based on patient vitals.</p>
            </div>
        `;
        updateAIRecommendations(0, 0, 0, 0);
        return;
    }
    
    const contributions = calculateFeatureContributions(pulse, spo2, temp);
    
    let riskColor, riskLabel;
    if (riskScore <= 30) {
        riskLabel = 'Low Risk';
        riskColor = '#27ae60';
    } else if (riskScore <= 60) {
        riskLabel = 'Medium Risk';
        riskColor = '#f39c12';
    } else {
        riskLabel = 'High Risk';
        riskColor = '#e74c3c';
    }
    
    let pulseStatus = '';
    let spo2Status = '';
    let tempStatus = '';
    
    if (pulse < 60) pulseStatus = ' (Bradycardia - Below normal)';
    else if (pulse > 100) pulseStatus = ' (Tachycardia - Above normal)';
    else pulseStatus = ' (Normal range)';
    
    if (spo2 < 95) spo2Status = ' (Below normal - Low oxygen levels)';
    else spo2Status = ' (Normal range)';
    
    if (temp < 36.0) tempStatus = ' (Hypothermia - Below normal)';
    else if (temp > 37.5) tempStatus = ' (Fever - Above normal)';
    else tempStatus = ' (Normal range)';
    
    xaiContent.innerHTML = `
        <div class="xai-risk-summary" style="background: ${riskColor}20; padding: 12px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid ${riskColor};">
            <h4 style="color: ${riskColor}; margin: 0 0 5px 0;">Risk Assessment: ${riskLabel} (${riskScore}%)</h4>
            <p style="margin: 0; font-size: 12px;">Based on AI analysis of patient vital signs using XGBoost model.</p>
        </div>
        
        <div class="contribution-item" style="margin-bottom: 18px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span>❤️ <strong>Pulse Rate</strong> - ${pulse} bpm${pulseStatus}</span>
                <span><strong>${contributions.pulse}%</strong></span>
            </div>
            <div class="contribution-bar-bg" style="background: #e0e0e0; border-radius: 10px; height: 20px; overflow: hidden;">
                <div class="contribution-bar" style="width: ${contributions.pulse}%; background: #3498db; height: 100%; transition: width 0.3s ease;"></div>
            </div>
            <p style="font-size: 11px; color: #666; margin: 5px 0 0 5px;">Impact: ${contributions.pulse > 33 ? 'High' : (contributions.pulse > 20 ? 'Medium' : 'Low')} contribution to overall risk</p>
        </div>
        
        <div class="contribution-item" style="margin-bottom: 18px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span>🩸 <strong>Oxygen Saturation (SpO2)</strong> - ${spo2}%${spo2Status}</span>
                <span><strong>${contributions.spo2}%</strong></span>
            </div>
            <div class="contribution-bar-bg" style="background: #e0e0e0; border-radius: 10px; height: 20px; overflow: hidden;">
                <div class="contribution-bar" style="width: ${contributions.spo2}%; background: #2ecc71; height: 100%; transition: width 0.3s ease;"></div>
            </div>
            <p style="font-size: 11px; color: #666; margin: 5px 0 0 5px;">Impact: ${contributions.spo2 > 25 ? 'High' : (contributions.spo2 > 15 ? 'Medium' : 'Low')} contribution to overall risk</p>
        </div>
        
        <div class="contribution-item" style="margin-bottom: 18px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span>🌡️ <strong>Body Temperature</strong> - ${temp}°C${tempStatus}</span>
                <span><strong>${contributions.temp}%</strong></span>
            </div>
            <div class="contribution-bar-bg" style="background: #e0e0e0; border-radius: 10px; height: 20px; overflow: hidden;">
                <div class="contribution-bar" style="width: ${contributions.temp}%; background: #e74c3c; height: 100%; transition: width 0.3s ease;"></div>
            </div>
            <p style="font-size: 11px; color: #666; margin: 5px 0 0 5px;">Impact: ${contributions.temp > 18 ? 'High' : (contributions.temp > 10 ? 'Medium' : 'Low')} contribution to overall risk</p>
        </div>
    `;
    
    // Update the right panel with AI Recommendations
    updateAIRecommendations(pulse, spo2, temp, riskScore);
}

// ========== MANUAL RISK ASSESSMENT ==========

function calculateRisk() {
    let name, patientId;
    
    if (currentUserRole === 'patient') {
        name = currentUserName;
        patientId = currentPatientId;
    } else {
        name = document.getElementById('patientName').value;
        patientId = document.getElementById('patientId').value;
        
        if (name && (!patientId || patientId === 'N/A')) {
            const foundPatient = patientsList.find(p => p.name.toLowerCase() === name.toLowerCase());
            if (foundPatient) {
                patientId = foundPatient.patient_id;
                console.log(`Found patient: ${name} with ID: ${patientId}`);
            } else {
                alert(`Patient "${name}" not found. Please create the patient account first in Manage Patients.`);
                return;
            }
        }
        
        if (!name || !patientId) {
            alert('Please enter a valid patient name from the registered patients list');
            return;
        }
    }
    
    const pulse = parseInt(document.getElementById('pulse').value);
    const spo2 = parseInt(document.getElementById('spo2').value);
    const temp = parseFloat(document.getElementById('temp').value);
    
    if (!pulse || !spo2 || !temp) { alert('Please fill all vital signs'); return; }
    
    fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pulse, spo2, temperature: temp })
    })
    .then(response => response.json())
    .then(result => {
        const risk = result.risk_score;
        
        const contributions = calculateFeatureContributions(pulse, spo2, temp);
        currentRiskContributions = contributions;
        currentPatientData = { name, pulse, spo2, temp, risk };
        
        // UPDATE XAI HERE - Manual check
        updateXAIExplanation(pulse, spo2, temp, risk);
        if (featureChart) updateFeatureChartWithContributions();
        
        return fetch('/api/save_record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                patient_name: name,
                patient_id: patientId,
                pulse: pulse,
                spo2: spo2,
                temperature: temp,
                risk: risk
            })
        }).then(() => result);
    })
    .then(result => {
        document.getElementById('riskResult').style.display = 'block';
        document.getElementById('riskScore').innerHTML = result.risk_score + '%';
        document.getElementById('riskBarFill').style.width = result.risk_score + '%';
        document.getElementById('riskBarFill').className = 'risk-bar-fill ' + (result.risk_score <= 30 ? 'low-fill' : result.risk_score <= 60 ? 'medium-fill' : 'high-fill');
        document.getElementById('riskGuidance').innerHTML = result.guidance;
        
        loadRecords();
        loadDashboardStatsOnly();  // Only updates total & high risk (average vitals stay static)
        if (currentUserRole === 'doctor') loadPatientList();
        
        alert('✅ Risk calculated and record saved!');
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Error calculating risk. Please try again.');
    });
}

// ========== PATIENT MANAGEMENT ==========

function createPatientAccount() {
    const name = document.getElementById('newPatientName').value;
    const username = document.getElementById('newPatientUsername').value;
    const password = document.getElementById('newPatientPassword').value;
    
    if (!name || !username || !password) {
        alert('Please fill all fields');
        return;
    }
    
    fetch('/api/create_patient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert(`✅ Patient "${name}" created successfully!\n\nUsername: ${username}\nPassword: ${password}\nPatient ID: ${data.patient_id}`);
            
            document.getElementById('newPatientName').value = '';
            document.getElementById('newPatientUsername').value = '';
            document.getElementById('newPatientPassword').value = '';
            
            loadPatientList();
        } else {
            alert('Error: ' + data.error);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to create patient account');
    });
}

function loadPatientList() {
    fetch('/api/patients')
        .then(response => response.json())
        .then(patients => {
            patientsList = patients;
            const tbody = document.getElementById('patientListBody');
            if (!tbody) return;
            
            const datalist = document.getElementById('patientNamesList');
            if (datalist) {
                datalist.innerHTML = patients.map(p => `<option value="${escapeHtml(p.name)}">`).join('');
            }
            
            if (patients.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center">No patients registered. Create your first patient above.</td></tr>`;
                return;
            }
            
            tbody.innerHTML = patients.map(p => `
                <tr>
                    <td>${p.patient_id}</td>
                    <td><strong>${escapeHtml(p.name)}</strong></td>
                    <td>${escapeHtml(p.username)}</td>
                    <td>${p.record_count} records</span></td>
                    <td>${new Date(p.created_at).toLocaleDateString()}</span></td>
                    <td class="patient-actions">
                        <button class="reset-pwd-btn" onclick="resetPatientPassword(${p.id})">Reset Pwd</button>
                        <button class="view-records-btn" onclick="viewPatientRecords('${p.patient_id}', '${escapeHtml(p.name)}')">View Records</button>
                        <button class="delete-patient-btn" onclick="deletePatientAccount(${p.id})">Delete</button>
                    </span></td>
                </tr>
            `).join('');
        })
        .catch(error => console.error('Error:', error));
}

function resetPatientPassword(userId) {
    const newPassword = prompt('Enter new password for this patient:', 'password123');
    if (!newPassword) return;
    
    fetch('/api/reset_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, new_password: newPassword })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('✅ Password reset successfully!');
        } else {
            alert('Error: ' + data.error);
        }
    })
    .catch(error => console.error('Error:', error));
}

function viewPatientRecords(patientId, patientName) {
    alert(`📊 Viewing records for ${patientName}.`);
    const recordsLink = document.querySelector('.menu-link[data-page="records"]');
    if (recordsLink) recordsLink.click();
    
    setTimeout(() => {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = patientName;
            filterRecords();
        }
    }, 200);
}

function deletePatientAccount(userId) {
    if (!confirm('Are you sure you want to delete this patient and ALL their records? This cannot be undone.')) return;
    
    fetch(`/api/delete_patient/${userId}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('✅ Patient deleted successfully!');
            loadPatientList();
            loadRecords();
            loadDashboardStatsOnly();  // Only updates total & high risk
        } else {
            alert('Error: ' + data.error);
        }
    })
    .catch(error => console.error('Error:', error));
}

// ========== RECORDS MANAGEMENT ==========

function loadRecords() {
    fetch('/api/records')
        .then(response => response.json())
        .then(records => {
            displayRecords(records);
            if (currentUserRole === 'patient') {
                updatePatientRecordCount(records.length);
            }
        })
        .catch(error => console.error('Error loading records:', error));
}

function displayRecords(records) {
    const tbody = document.getElementById('recordsList');
    if (!records.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">No records found</span></td>';
        return;
    }
    
    tbody.innerHTML = records.map(r => {
        // Format vitals nicely - limit decimal places for temperature
        const tempValue = typeof r.temperature === 'number' ? r.temperature.toFixed(1) : r.temperature;
        const vitalsText = `P:${r.pulse} | SpO₂:${r.spo2}% | T:${tempValue}°C`;
        
        // Format date nicely
        let formattedDate = '';
        if (r.date) {
            try {
                const dateObj = new Date(r.date);
                formattedDate = dateObj.toLocaleString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
            } catch(e) {
                formattedDate = r.date;
            }
        } else {
            formattedDate = 'N/A';
        }
        
        // Determine risk color
        let riskBgColor;
        if (r.risk <= 30) {
            riskBgColor = '#27ae60';
        } else if (r.risk <= 60) {
            riskBgColor = '#f39c12';
        } else {
            riskBgColor = '#e74c3c';
        }
        
        // Build action buttons - ALL IN ONE ROW
        let actionButtons = `
            <button class="analyze-btn" onclick="analyzeRecord(${r.id})" title="Analyze" style="padding: 4px 8px; margin: 0 2px; cursor: pointer;">
                <i class="bi bi-graph-up"></i> Analyze
            </button>
            <button class="pdf-btn" onclick="downloadPDF(${r.id})" title="Download PDF" style="padding: 4px 8px; margin: 0 2px; cursor: pointer;">
                <i class="bi bi-file-pdf"></i> PDF
            </button>
            <button class="email-btn" onclick="sendEmailReport(${r.id})" title="Send Email" style="padding: 4px 8px; margin: 0 2px; cursor: pointer;">
                <i class="bi bi-envelope"></i> Email
            </button>
        `;
        
        // Add delete button for doctors
        if (currentUserRole === 'doctor') {
            actionButtons += `
                <button class="delete-btn" onclick="deleteRecord(${r.id})" title="Delete Record" style="padding: 4px 8px; margin: 0 2px; cursor: pointer; background-color: #e74c3c; color: white; border: none; border-radius: 4px;">
                    <i class="bi bi-trash"></i> Delete
                </button>
            `;
        }
        
        return `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 12px 8px;">${r.id}</td>
                <td style="padding: 12px 8px;"><strong>${escapeHtml(r.patient_name)}</strong></td>
                <td style="padding: 12px 8px;">${vitalsText}</td>
                <td style="padding: 12px 8px;">
                    <span style="background:${riskBgColor}; color:white; padding:4px 10px; border-radius:20px; font-weight:bold;">
                        ${r.risk}%
                    </span>
                </td>
                <td style="padding: 12px 8px; white-space: nowrap;">${formattedDate}</td>
                <td class="action-buttons" style="padding: 12px 8px; white-space: nowrap;">
                    ${actionButtons}
                </td>
            </tr>
        `;
    }).join('');
}

// ========== ANALYZE RECORD FUNCTION ==========

function analyzeRecord(id) {
    console.log('🔍 Analyzing record ID:', id);
    
    fetch('/api/records')
        .then(response => response.json())
        .then(records => {
            const record = records.find(r => r.id === id);
            if (record) {
                console.log('📊 Record found:', record);
                console.log('📊 Risk value:', record.risk, 'Type:', typeof record.risk);
                
                currentPatientData = {
                    name: record.patient_name,
                    pulse: record.pulse,
                    spo2: record.spo2,
                    temp: record.temperature,
                    risk: record.risk
                };
                
                currentRiskContributions = calculateFeatureContributions(
                    record.pulse, 
                    record.spo2, 
                    record.temperature
                );
                
                // Update both panels with the record data
                updateXAIExplanation(
                    record.pulse, 
                    record.spo2, 
                    record.temperature, 
                    record.risk
                );
                
                if (featureChart) {
                    updateFeatureChartWithContributions();
                }
                
                const xaiLink = document.querySelector('.menu-link[data-page="xai"]');
                if (xaiLink) {
                    xaiLink.click();
                    
                    const toast = document.createElement('div');
                    toast.style.position = 'fixed';
                    toast.style.bottom = '20px';
                    toast.style.right = '20px';
                    toast.style.backgroundColor = '#27ae60';
                    toast.style.color = 'white';
                    toast.style.padding = '12px 20px';
                    toast.style.borderRadius = '10px';
                    toast.style.zIndex = '1000';
                    toast.innerHTML = `✓ Loaded analysis for ${record.patient_name} (Risk: ${record.risk}%)`;
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 2000);
                }
            } else {
                console.error('Record not found with ID:', id);
                alert('Record not found!');
            }
        })
        .catch(error => {
            console.error('Error analyzing record:', error);
            alert('Error loading record data. Please try again.');
        });
}

function deleteRecord(id) {
    if (currentUserRole !== 'doctor') { alert('Only doctors can delete records'); return; }
    if (!confirm('Delete this record?')) return;
    
    fetch(`/api/delete_record/${id}`, { method: 'DELETE' })
        .then(() => {
            loadRecords();
            loadDashboardStatsOnly();  // Only updates total & high risk
        })
        .catch(error => console.error('Error:', error));
}

function clearAllRecords() {
    if (currentUserRole !== 'doctor') { alert('Only doctors can clear records'); return; }
    if (!confirm('Delete ALL records?')) return;
    
    fetch('/api/clear_all_records', { method: 'DELETE' })
        .then(() => {
            loadRecords();
            loadDashboardStatsOnly();  // Only updates total & high risk
        })
        .catch(error => console.error('Error:', error));
}

// ========== PDF AND EMAIL FUNCTIONS ==========

function downloadPDF(recordId) {
    console.log("Downloading PDF for record:", recordId);
    
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.backgroundColor = '#3498db';
    toast.style.color = 'white';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '10px';
    toast.style.zIndex = '1000';
    toast.innerHTML = '📄 Generating PDF...';
    document.body.appendChild(toast);
    
    fetch(`/api/download_pdf/${recordId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('PDF generation failed');
            }
            return response.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `MATERNAI_Report_${recordId}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            toast.innerHTML = '✅ PDF Downloaded!';
            toast.style.backgroundColor = '#27ae60';
            setTimeout(() => toast.remove(), 2000);
        })
        .catch(error => {
            console.error('PDF Error:', error);
            toast.innerHTML = '❌ PDF Failed! Check console';
            toast.style.backgroundColor = '#e74c3c';
            setTimeout(() => toast.remove(), 3000);
            alert('Failed to download PDF. Please check if server is running.');
        });
}

function sendEmailReport(recordId) {
    console.log("Sending email for record:", recordId);
    
    const email = prompt('Enter patient email address:', '');
    
    if (!email) {
        alert('Email address is required');
        return;
    }
    
    if (!email.includes('@') || !email.includes('.')) {
        alert('Please enter a valid email address');
        return;
    }
    
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.backgroundColor = '#3498db';
    toast.style.color = 'white';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '10px';
    toast.style.zIndex = '1000';
    toast.innerHTML = '📧 Sending email...';
    document.body.appendChild(toast);
    
    fetch('/api/send_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            record_id: recordId, 
            email: email 
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            toast.innerHTML = '✅ Email sent successfully!';
            toast.style.backgroundColor = '#27ae60';
            setTimeout(() => toast.remove(), 2000);
        } else {
            throw new Error(data.error || 'Failed to send email');
        }
    })
    .catch(error => {
        console.error('Email Error:', error);
        toast.innerHTML = '❌ Email failed: ' + error.message;
        toast.style.backgroundColor = '#e74c3c';
        setTimeout(() => toast.remove(), 3000);
        alert('Failed to send email. Error: ' + error.message);
    });
}

// ========== REAL-TIME MONITORING WITH SENSOR DATA ==========

function startMonitor() {
    const name = document.getElementById('monitorName').value;
    let patientId = document.getElementById('monitorId').value;
    
    if (!name) { 
        alert('Enter patient name'); 
        return; 
    }
    
    if (currentUserRole === 'doctor' && name && (!patientId || patientId === '')) {
        const foundPatient = patientsList.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (foundPatient) {
            patientId = foundPatient.patient_id;
            document.getElementById('monitorId').value = patientId;
        } else {
            alert(`Patient "${name}" not found. Please create the patient account first.`);
            return;
        }
    }
    
    if (currentUserRole === 'patient') {
        realtimePatientName = currentUserName;
        realtimePatientId = currentPatientId;
        document.getElementById('monitorName').value = currentUserName;
        document.getElementById('monitorId').value = currentPatientId;
    } else {
        realtimePatientName = name;
        realtimePatientId = patientId;
    }
    
    if (realtimeIntervalRunning) {
        alert('Monitoring is already active!');
        return;
    }
    
    document.getElementById('startRealtimeBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'inline-block';
    document.getElementById('monitorStatus').innerHTML = '🟡 Starting monitoring... Please wait';
    document.getElementById('monitorStatus').className = 'status-indicator connected';
    
    realtimePulse = 0;
    realtimeSpO2 = 0;
    realtimeTemp = 0;
    realtimeRisk = 0;
    realtimeReadingCount = 0;
    readingsArray = [];
    
    fetch('/api/start_monitoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            patient_name: realtimePatientName,
            patient_id: realtimePatientId
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('✅ ESP32 monitoring started');
            realtimeIntervalRunning = true;
            document.getElementById('monitorStatus').innerHTML = '🟢 Monitoring active - Collecting readings...';
            startSensorDataFetching();
        } else {
            alert('Failed to start ESP32 monitoring: ' + data.error);
            resetMonitorUI();
        }
    })
    .catch(error => {
        console.error('Error starting monitor:', error);
        alert('Could not communicate with ESP32. Please check connection.');
        resetMonitorUI();
    });
}

function resetMonitorUI() {
    document.getElementById('startRealtimeBtn').style.display = 'inline-block';
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('monitorStatus').innerHTML = '⚫ Ready for next session';
    document.getElementById('monitorStatus').className = 'status-indicator disconnected';
    document.getElementById('monitorStatus').style.background = '';
    document.getElementById('monitorStatus').style.color = '';
    realtimeIntervalRunning = false;
    readingsArray = [];
}

function startSensorDataFetching() {
    if (sensorDataInterval) clearInterval(sensorDataInterval);
    
    sensorDataInterval = setInterval(() => {
        if (!realtimeIntervalRunning) return;
        fetchSensorData();
    }, 3000);
    
    fetchSensorData();
}

function fetchSensorData() {
    fetch('/api/sensor_data')
        .then(response => response.json())
        .then(data => {
            console.log('Sensor data received:', data);
            
            if (data.success) {
                updateLiveVitalsDisplayWithData(data);
                
                if (data.monitoring) {
                    if (data.pulse > 0) realtimePulse = data.pulse;
                    if (data.spo2 > 0) realtimeSpO2 = data.spo2;
                    if (data.temperature > 0) realtimeTemp = data.temperature;
                    
                    let risk = data.risk;
                    if (!risk && data.pulse > 0) {
                        risk = 30;
                        if (data.pulse > 100 || data.pulse < 60) risk += 20;
                        if (data.spo2 < 95) risk += 30;
                        if (data.temperature > 37.5 || data.temperature < 36.0) risk += 20;
                        risk = Math.min(risk, 100);
                    }
                    realtimeRisk = risk;
                    
                    if (realtimePulse > 0 && realtimeSpO2 > 0 && realtimeTemp > 0) {
                        readingsArray.push({
                            pulse: realtimePulse,
                            spo2: realtimeSpO2,
                            temp: realtimeTemp,
                            risk: realtimeRisk
                        });
                        realtimeReadingCount = readingsArray.length;
                        
                        console.log(`📊 Reading ${realtimeReadingCount}/${maxReadings}: Pulse=${realtimePulse}, SpO2=${realtimeSpO2}, Temp=${realtimeTemp}, Risk=${realtimeRisk}%`);
                        
                        currentPatientData = { 
                            name: realtimePatientName, 
                            pulse: Math.round(realtimePulse), 
                            spo2: Math.round(realtimeSpO2), 
                            temp: realtimeTemp, 
                            risk: realtimeRisk 
                        };
                        currentRiskContributions = calculateFeatureContributions(realtimePulse, realtimeSpO2, realtimeTemp);
                        
                        if (featureChart && currentRiskContributions.pulse > 0) {
                            updateFeatureChartWithContributions();
                        }
                        updateXAIExplanation(Math.round(realtimePulse), Math.round(realtimeSpO2), realtimeTemp, realtimeRisk);
                    }
                    
                    const remaining = maxReadings - realtimeReadingCount;
                    let statusMessage = '';
                    if (realtimeRisk > 70) {
                        statusMessage = '🔴 HIGH RISK ALERT!';
                        document.getElementById('monitorStatus').style.background = '#f8d7da';
                        document.getElementById('monitorStatus').style.color = '#721c24';
                    } else if (realtimeRisk > 30) {
                        statusMessage = '🟡 Medium Risk - Monitor closely';
                        document.getElementById('monitorStatus').style.background = '#fff3cd';
                        document.getElementById('monitorStatus').style.color = '#856404';
                    } else {
                        statusMessage = '🟢 Vitals Stable';
                        document.getElementById('monitorStatus').style.background = '#d4edda';
                        document.getElementById('monitorStatus').style.color = '#155724';
                    }
                    document.getElementById('monitorStatus').innerHTML = `📊 Reading ${realtimeReadingCount}/${maxReadings} | Remaining: ${remaining} | ${statusMessage}`;
                    
                    if (realtimeReadingCount >= maxReadings) {
                        console.log('✅ Max readings reached. Calculating and saving average...');
                        calculateAndSaveAverage();
                        stopMonitor();
                    }
                } else if (realtimeIntervalRunning) {
                    console.log('Monitoring stopped by ESP32');
                    if (readingsArray.length > 0) {
                        calculateAndSaveAverage();
                    }
                    stopMonitor();
                }
            } else {
                console.warn('Sensor not connected:', data);
                if (realtimeIntervalRunning) {
                    document.getElementById('monitorStatus').innerHTML = '⚠️ Waiting for ESP32 connection...';
                }
            }
        })
        .catch(error => {
            console.error('Error fetching sensor data:', error);
            if (realtimeIntervalRunning) {
                document.getElementById('monitorStatus').innerHTML = '⚠️ Sensor disconnected. Check ESP32 connection.';
            }
        });
}

function calculateAndSaveAverage() {
    if (readingsArray.length === 0) {
        console.log('No readings to save');
        return;
    }
    
    const avgPulse = Math.round(readingsArray.reduce((sum, r) => sum + r.pulse, 0) / readingsArray.length);
    const avgSpO2 = Math.round(readingsArray.reduce((sum, r) => sum + r.spo2, 0) / readingsArray.length);
    const avgTemp = readingsArray.reduce((sum, r) => sum + r.temp, 0) / readingsArray.length;
    
    let avgRisk = 30;
    if (avgPulse > 100 || avgPulse < 60) avgRisk += 20;
    if (avgSpO2 < 95) avgRisk += 30;
    if (avgTemp > 37.5 || avgTemp < 36.0) avgRisk += 20;
    avgRisk = Math.min(avgRisk, 100);
    
    console.log(`📊 AVERAGE OF ${readingsArray.length} READINGS:`);
    console.log(`   Pulse: ${avgPulse} bpm`);
    console.log(`   SpO2: ${avgSpO2}%`);
    console.log(`   Temperature: ${avgTemp.toFixed(1)}°C`);
    console.log(`   Risk Score: ${avgRisk}%`);
    
    fetch('/api/save_record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            patient_name: realtimePatientName,
            patient_id: realtimePatientId,
            pulse: avgPulse,
            spo2: avgSpO2,
            temperature: avgTemp,
            risk: avgRisk
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('✅ Average reading saved to database!');
            document.getElementById('monitorStatus').innerHTML = `✅ Average saved! (${readingsArray.length} readings)`;
            loadRecords();
            loadDashboardStatsOnly();  // Only updates total & high risk (average vitals stay static)
        }
    })
    .catch(error => console.error('Error saving average:', error));
}

function updateLiveVitalsDisplayWithData(data) {
    const pulseEl = document.getElementById('livePulse');
    const spo2El = document.getElementById('liveSpO2');
    const tempEl = document.getElementById('liveTemp');
    const pulseStatus = document.getElementById('livePulseStatus');
    const spo2Status = document.getElementById('liveSpO2Status');
    const tempStatus = document.getElementById('liveTempStatus');
    
    if (pulseEl) {
        if (data.pulse > 0) {
            pulseEl.innerText = Math.round(data.pulse);
            if (pulseStatus) {
                const normal = data.pulse >= 60 && data.pulse <= 100;
                pulseStatus.innerHTML = normal ? '✅ Normal' : '⚠️ Abnormal';
                pulseStatus.className = normal ? 'vital-status normal' : 'vital-status warning';
            }
        } else {
            pulseEl.innerText = '--';
            if (pulseStatus) {
                pulseStatus.innerHTML = '⏳ Waiting';
                pulseStatus.className = 'vital-status waiting';
            }
        }
    }
    
    if (spo2El) {
        if (data.spo2 > 0) {
            spo2El.innerText = Math.round(data.spo2);
            if (spo2Status) {
                const normal = data.spo2 >= 95;
                spo2Status.innerHTML = normal ? '✅ Normal' : '⚠️ Low';
                spo2Status.className = normal ? 'vital-status normal' : 'vital-status warning';
            }
        } else {
            spo2El.innerText = '--';
            if (spo2Status) {
                spo2Status.innerHTML = '⏳ Waiting';
                spo2Status.className = 'vital-status waiting';
            }
        }
    }
    
    if (tempEl) {
        if (data.temperature > 0) {
            tempEl.innerText = data.temperature.toFixed(1);
            if (tempStatus) {
                const normal = data.temperature >= 36.5 && data.temperature <= 37.5;
                tempStatus.innerHTML = normal ? '✅ Normal' : '⚠️ Abnormal';
                tempStatus.className = normal ? 'vital-status normal' : 'vital-status warning';
            }
        } else {
            tempEl.innerText = '--';
            if (tempStatus) {
                tempStatus.innerHTML = '⏳ Waiting';
                tempStatus.className = 'vital-status waiting';
            }
        }
    }
}

function stopMonitor() {
    if (!realtimeIntervalRunning) {
        resetMonitorUI();
        return;
    }
    
    fetch('/api/stop_monitoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('✅ Stop command sent to ESP32');
        }
    })
    .catch(error => console.error('Error sending stop command:', error));
    
    if (sensorDataInterval) {
        clearInterval(sensorDataInterval);
        sensorDataInterval = null;
    }
    
    realtimeIntervalRunning = false;
    
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('startRealtimeBtn').style.display = 'inline-block';
    document.getElementById('monitorStatus').innerHTML = '✅ Monitoring Stopped - Average saved to records';
    document.getElementById('monitorStatus').className = 'status-indicator success';
    document.getElementById('monitorStatus').style.background = '#d4edda';
    document.getElementById('monitorStatus').style.color = '#155724';
    
    loadRecords();
    loadDashboardStatsOnly();  // Only updates total & high risk
    
    setTimeout(() => {
        if (!realtimeIntervalRunning) {
            document.getElementById('monitorStatus').innerHTML = '⚫ Ready for next session';
            document.getElementById('monitorStatus').className = 'status-indicator disconnected';
            document.getElementById('monitorStatus').style.background = '';
            document.getElementById('monitorStatus').style.color = '';
        }
    }, 3000);
    
    readingsArray = [];
    realtimeReadingCount = 0;
}

function updateLiveVitalsDisplay() {
    const pulseEl = document.getElementById('livePulse');
    const spo2El = document.getElementById('liveSpO2');
    const tempEl = document.getElementById('liveTemp');
    
    if (pulseEl) pulseEl.innerText = realtimePulse > 0 ? Math.round(realtimePulse) : '--';
    if (spo2El) spo2El.innerText = realtimeSpO2 > 0 ? Math.round(realtimeSpO2) : '--';
    if (tempEl) tempEl.innerText = realtimeTemp > 0 ? realtimeTemp.toFixed(1) : '--';
    
    const pulseNormal = realtimePulse >= 60 && realtimePulse <= 100;
    const spo2Normal = realtimeSpO2 >= 95;
    const tempNormal = realtimeTemp >= 36.5 && realtimeTemp <= 37.5;
    
    const pulseStatus = document.getElementById('livePulseStatus');
    const spo2Status = document.getElementById('liveSpO2Status');
    const tempStatus = document.getElementById('liveTempStatus');
    
    if (pulseStatus) {
        if (realtimePulse > 0) {
            pulseStatus.innerHTML = pulseNormal ? '✅ Normal' : '⚠️ Abnormal';
            pulseStatus.className = pulseNormal ? 'vital-status normal' : 'vital-status warning';
        } else {
            pulseStatus.innerHTML = '⏳ Waiting';
            pulseStatus.className = 'vital-status waiting';
        }
    }
    if (spo2Status) {
        if (realtimeSpO2 > 0) {
            spo2Status.innerHTML = spo2Normal ? '✅ Normal' : '⚠️ Low';
            spo2Status.className = spo2Normal ? 'vital-status normal' : 'vital-status warning';
        } else {
            spo2Status.innerHTML = '⏳ Waiting';
            spo2Status.className = 'vital-status waiting';
        }
    }
    if (tempStatus) {
        if (realtimeTemp > 0) {
            tempStatus.innerHTML = tempNormal ? '✅ Normal' : '⚠️ Abnormal';
            tempStatus.className = tempNormal ? 'vital-status normal' : 'vital-status warning';
        } else {
            tempStatus.innerHTML = '⏳ Waiting';
            tempStatus.className = 'vital-status waiting';
        }
    }
}

// ========== CHAT HISTORY FUNCTIONS ==========

function toggleChatHistory() {
    const sidebar = document.getElementById('chatHistorySidebar');
    if (sidebar.style.display === 'none') {
        sidebar.style.display = 'flex';
        loadChatHistoryList();
    } else {
        sidebar.style.display = 'none';
    }
}

function loadChatHistoryList() {
    const userId = 'user_' + (currentPatientId || currentUserName || 'anonymous');
    const historyList = document.getElementById('chatHistoryList');
    historyList.innerHTML = '<div class="history-loading">Loading conversations...</div>';
    
    fetch(`/api/chat/conversations?user_id=${userId}`)
        .then(response => response.json())
        .then(conversations => {
            if (!conversations || conversations.length === 0) {
                historyList.innerHTML = '<div class="history-empty">No conversations yet.<br>Start a new chat!</div>';
                return;
            }
            
            chatHistoryList = conversations;
            
            historyList.innerHTML = conversations.map(conv => `
                <div class="history-item ${currentConversationId === conv.id ? 'active' : ''}" 
                     onclick="loadConversation(${conv.id})">
                    <div class="history-item-title">Chat ${new Date(conv.created_at).toLocaleDateString()}</div>
                    <div class="history-item-date">${new Date(conv.created_at).toLocaleString()}</div>
                </div>
            `).join('');
        })
        .catch(error => {
            console.error('Error loading history:', error);
            historyList.innerHTML = '<div class="history-empty">Error loading history</div>';
        });
}

function loadConversation(conversationId) {
    currentConversationId = conversationId;
    
    fetch(`/api/chat/history/${conversationId}`)
        .then(response => response.json())
        .then(messages => {
            displayChatMessages(messages);
            
            document.querySelectorAll('.history-item').forEach(item => {
                item.classList.remove('active');
            });
            const activeItem = document.querySelector(`.history-item[onclick="loadConversation(${conversationId})"]`);
            if (activeItem) activeItem.classList.add('active');
            
            if (window.innerWidth <= 768) {
                toggleChatHistory();
            }
        })
        .catch(error => console.error('Error loading conversation:', error));
}

// ========== AI CHATBOT WITH PERSISTENT HISTORY ==========

function loadChatHistory() {
    const userId = 'user_' + (currentPatientId || currentUserName || 'anonymous');
    
    fetch(`/api/chat/conversations?user_id=${userId}`)
        .then(response => response.json())
        .then(conversations => {
            if (conversations && conversations.length > 0) {
                currentConversationId = conversations[0].id;
                return fetch(`/api/chat/history/${currentConversationId}`);
            } else {
                return createNewConversation();
            }
        })
        .then(response => {
            if (response && response.ok) {
                return response.json();
            }
            return null;
        })
        .then(messages => {
            if (messages && messages.length > 0) {
                displayChatMessages(messages);
            } else if (!currentConversationId) {
                showWelcomeMessage();
            } else if (messages && messages.length === 0) {
                showWelcomeMessage();
            }
        })
        .catch(error => {
            console.error('Error loading chat history:', error);
            showWelcomeMessage();
        });
}

function createNewConversation() {
    const userId = 'user_' + (currentPatientId || currentUserName || 'anonymous');
    const patientId = currentUserRole === 'patient' ? currentPatientId : null;
    
    return fetch('/api/chat/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, patient_id: patientId })
    })
    .then(response => response.json())
    .then(data => {
        currentConversationId = data.conversation_id;
        return null;
    });
}

function displayChatMessages(messages) {
    const chatDiv = document.getElementById('chatMessages');
    chatDiv.innerHTML = '';
    
    messages.forEach(msg => {
        const msgTime = new Date(msg.timestamp);
        const timeStr = msgTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        if (msg.role === 'user') {
            chatDiv.innerHTML += `
                <div class="msg user">
                    <div class="message-content">
                        <div class="message-bubble">
                            <div class="message-text">${escapeHtml(msg.content)}</div>
                            <div class="message-time">${timeStr}</div>
                        </div>
                        <div class="message-avatar">👤</div>
                    </div>
                </div>
            `;
        } else {
            chatDiv.innerHTML += `
                <div class="msg assistant">
                    <div class="message-content">
                        <div class="message-avatar">🤖</div>
                        <div class="message-bubble">
                            <div class="message-text">${escapeHtml(msg.content)}</div>
                            <div class="message-time">${timeStr}</div>
                        </div>
                    </div>
                </div>
            `;
        }
    });
    
    chatDiv.scrollTop = chatDiv.scrollHeight;
}

function showWelcomeMessage() {
    const chatDiv = document.getElementById('chatMessages');
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    chatDiv.innerHTML = `
        <div class="msg assistant">
            <div class="message-content">
                <div class="message-avatar">🤖</div>
                <div class="message-bubble">
                    <div class="message-text">👋 Hello! I'm MATERNAI, your maternal health assistant. I can help you with questions about pregnancy, symptoms, nutrition, risk factors, and more. What would you like to know?</div>
                    <div class="message-time">${timeStr}</div>
                </div>
            </div>
        </div>
    `;
    
    createNewConversation();
}

function startNewChat() {
    if (confirm('Start a new conversation? Your current chat history will be saved.')) {
        currentConversationId = null;
        showWelcomeMessage();
        
        if (document.getElementById('chatHistorySidebar').style.display === 'flex') {
            loadChatHistoryList();
        }
    }
}

function handleEnterKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;
    if (isTyping) return;
    
    const chatDiv = document.getElementById('chatMessages');
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    chatDiv.innerHTML += `
        <div class="msg user">
            <div class="message-content">
                <div class="message-bubble">
                    <div class="message-text">${escapeHtml(message)}</div>
                    <div class="message-time">${timeStr}</div>
                </div>
                <div class="message-avatar">👤</div>
            </div>
        </div>
    `;
    
    input.value = '';
    input.style.height = 'auto';
    chatDiv.scrollTop = chatDiv.scrollHeight;
    
    showTypingIndicator();
    isTyping = true;
    
    if (!currentConversationId) {
        createNewConversation().then(() => {
            sendMessageToBackend(message);
        });
    } else {
        sendMessageToBackend(message);
    }
}

function sendMessageToBackend(message) {
    fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            conversation_id: currentConversationId, 
            message: message 
        })
    })
    .then(response => response.json())
    .then(data => {
        removeTypingIndicator();
        isTyping = false;
        
        const responseTime = new Date();
        const responseTimeStr = responseTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const chatDiv = document.getElementById('chatMessages');
        chatDiv.innerHTML += `
            <div class="msg assistant">
                <div class="message-content">
                    <div class="message-avatar">🤖</div>
                    <div class="message-bubble">
                        <div class="message-text">${escapeHtml(data.response)}</div>
                        <div class="message-time">${responseTimeStr}</div>
                    </div>
                </div>
            </div>
        `;
        chatDiv.scrollTop = chatDiv.scrollHeight;
        
        if (document.getElementById('chatHistorySidebar').style.display === 'flex') {
            loadChatHistoryList();
        }
    })
    .catch(error => {
        removeTypingIndicator();
        isTyping = false;
        console.error('Error:', error);
        
        const chatDiv = document.getElementById('chatMessages');
        const errorTime = new Date();
        const errorTimeStr = errorTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        chatDiv.innerHTML += `
            <div class="msg assistant">
                <div class="message-content">
                    <div class="message-avatar">🤖</div>
                    <div class="message-bubble">
                        <div class="message-text">⚠️ Sorry, I encountered an error. Please try again.</div>
                        <div class="message-time">${errorTimeStr}</div>
                    </div>
                </div>
            </div>
        `;
        chatDiv.scrollTop = chatDiv.scrollHeight;
    });
}

function showTypingIndicator() {
    const chatDiv = document.getElementById('chatMessages');
    removeTypingIndicator();
    
    const typingDiv = document.createElement('div');
    typingDiv.className = 'msg assistant typing-indicator';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `
        <div class="message-content">
            <div class="message-avatar">🤖</div>
            <div class="message-bubble">
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
                <div class="typing-text">MATERNAI is thinking</div>
            </div>
        </div>
    `;
    chatDiv.appendChild(typingDiv);
    chatDiv.scrollTop = chatDiv.scrollHeight;
}

function removeTypingIndicator() {
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== SEARCH & FILTER ==========

const searchInput = document.getElementById('searchInput');
const riskFilter = document.getElementById('riskFilter');

if (searchInput) {
    searchInput.addEventListener('input', filterRecords);
}
if (riskFilter) {
    riskFilter.addEventListener('change', filterRecords);
}

function filterRecords() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const filterRisk = document.getElementById('riskFilter').value;
    
    fetch('/api/records')
        .then(response => response.json())
        .then(records => {
            let filtered = records;
            filtered = filtered.filter(r => r.patient_name.toLowerCase().includes(searchTerm));
            
            if (filterRisk === 'low') filtered = filtered.filter(r => r.risk <= 30);
            else if (filterRisk === 'medium') filtered = filtered.filter(r => r.risk > 30 && r.risk <= 60);
            else if (filterRisk === 'high') filtered = filtered.filter(r => r.risk > 60);
            
            displayRecords(filtered);
        });
}

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', () => {
    console.log('MATERNAI System Initialized');
    setTimeout(() => initFeatureChart(), 100);
    
    const patientNameInput = document.getElementById('patientName');
    if (patientNameInput) {
        const datalist = document.createElement('datalist');
        datalist.id = 'patientNamesList';
        patientNameInput.setAttribute('list', 'patientNamesList');
        document.body.appendChild(datalist);
    }
    
    const historySidebar = document.getElementById('chatHistorySidebar');
    if (historySidebar) {
        historySidebar.style.display = 'none';
    }
    
    const roleActionText = document.getElementById('roleActionText');
    if (roleActionText) {
        roleActionText.innerHTML = '<span style="color: #7f8c8d;">Don\'t have an account? </span><a href="#" onclick="showDoctorRegisterModal()" style="color: #3498db; text-decoration: none; font-weight: 600;">Create Account</a>';
    }
    
    // Initialize static dashboard values (ensuring they never change)
    const avgHREl = document.getElementById('avgHR');
    const avgSpO2El = document.getElementById('avgSpO2');
    const avgTempEl = document.getElementById('avgTemp');
    
    if (avgHREl) avgHREl.innerHTML = STATIC_AVG_HR;
    if (avgSpO2El) avgSpO2El.innerHTML = STATIC_AVG_SPO2;
    if (avgTempEl) avgTempEl.innerHTML = STATIC_AVG_TEMP;
    
    fetch('/api/check_username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test' })
    })
    .then(r => r.json())
    .then(data => console.log('✅ Backend reachable:', data))
    .catch(e => console.error('❌ Backend NOT reachable:', e));
});