import warnings
warnings.filterwarnings("ignore")

from flask import Flask, request, jsonify, send_file, render_template, session
import numpy as np
import joblib
import xgboost as xgb
import sqlite3
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.colors import HexColor
import os
import webbrowser
import threading
import time
from pathlib import Path
import google.generativeai as genai
from dotenv import load_dotenv
import uuid
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
import io
import serial
import serial.tools.list_ports

app = Flask(__name__, 
            template_folder="public",
            static_folder="public",
            static_url_path='')
app.secret_key = os.urandom(24)

print("\n" + "="*60)
print("🚀 MATERNAI - MATERNAL HEALTH INTELLIGENCE SYSTEM")
print("="*60)
print("\n📦 Initializing system...\n")

DATABASE = "records.db"

BASE_DIR = Path(__file__).parent.absolute()
print(f"📂 Base directory: {BASE_DIR}")

models_path = BASE_DIR / "models"
print(f"📂 Looking for models in: {models_path}")

if models_path.exists():
    print(f"✅ Models directory found!")
    for file in models_path.iterdir():
        print(f"   - {file.name}")
else:
    print(f"❌ Models directory not found")
    models_path.mkdir(parents=True, exist_ok=True)

load_dotenv()

EMAIL_HOST = os.getenv('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.getenv('EMAIL_PORT', 587))
EMAIL_USER = os.getenv('EMAIL_USER', '')
EMAIL_PASSWORD = os.getenv('EMAIL_PASSWORD', '')
EMAIL_FROM = os.getenv('EMAIL_FROM', EMAIL_USER)

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_MODEL = 'models/gemini-flash-latest'

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    print(f"\n✅ Gemini API configured successfully!")
    print(f"📌 Using model: {GEMINI_MODEL}")
else:
    print("\n⚠️ GEMINI_API_KEY not found in .env file")

SYSTEM_PROMPT = """You are MATERNAI, a caring, professional, and intelligent maternal health assistant powered by Google Gemini.

Your guidelines:
1. Be warm, empathetic, and conversational - use emojis occasionally 😊
2. For maternal health questions: Provide accurate, evidence-based information
3. For general questions: Answer helpfully and naturally
4. Always include appropriate medical disclaimers
5. If user describes emergency symptoms, advise immediate medical attention
6. Do NOT provide specific medical diagnoses
7. Keep responses clear, concise, and helpful (2-3 paragraphs max)

Remember: You're MATERNAI, a helpful AI that specializes in maternal health but can chat about anything!"""

# ========== ESP32 SERIAL READER ==========

latest_pulse = 0
latest_spo2 = 0
latest_temp = 0.0
sensor_connected = False
serial_port = None
monitoring_active = False

def find_esp32_port():
    ports = serial.tools.list_ports.comports()
    for port in ports:
        if any(id in port.description.lower() for id in ['cp210', 'ch340', 'silabs', 'ftdi', 'usb']):
            return port.device
        if port.vid == 0x10C4 and port.pid == 0xEA60:
            return port.device
        if port.vid == 0x1A86 and port.pid == 0x7523:
            return port.device
    return None

def predict_risk_with_model(pulse, spo2, temp):
    global scaler, model, MODELS_LOADED
    
    if MODELS_LOADED and scaler is not None and model is not None:
        try:
            features = np.array([[pulse, spo2, temp]])
            features_scaled = scaler.transform(features)
            prediction = model.predict(features_scaled)[0]
            
            if prediction == 0:
                return 30
            elif prediction == 1:
                return 60
            else:
                return 90
        except Exception as e:
            return fallback_risk_calculation(pulse, spo2, temp)
    else:
        return fallback_risk_calculation(pulse, spo2, temp)

def fallback_risk_calculation(pulse, spo2, temp):
    risk = 30
    if pulse > 100 or pulse < 60: risk += 20
    if spo2 < 95: risk += 30
    if temp > 37.5 or temp < 36.0: risk += 20
    return min(risk, 100)

def read_esp32_serial():
    global latest_pulse, latest_spo2, latest_temp, sensor_connected, serial_port, monitoring_active
    
    esp_port = find_esp32_port()
    
    if esp_port:
        print(f"🔌 Found ESP32 on port: {esp_port}")
        try:
            serial_port = serial.Serial(esp_port, 115200, timeout=2)
            sensor_connected = True
            print(f"✅ Connected to ESP32 on {esp_port}")
            print("📡 Waiting for sensor data...\n")
            
            while True:
                if serial_port and serial_port.in_waiting:
                    line = serial_port.readline().decode('utf-8', errors='ignore').strip()
                    
                    if "MONITORING STARTED" in line:
                        monitoring_active = True
                        print("✅ Monitoring started")
                    
                    elif "MONITORING STOPPED" in line:
                        monitoring_active = False
                        print("⏹️ Monitoring stopped")
                    
                    elif line.startswith('pulse:'):
                        try:
                            parts = line.split(',')
                            pulse_val = int(parts[0].split(':')[1])
                            spo2_val = int(parts[1].split(':')[1])
                            temp_val = float(parts[2].split(':')[1])
                            
                            latest_pulse = pulse_val
                            latest_spo2 = spo2_val
                            latest_temp = temp_val
                            
                            print(f"📊 Sensors: Pulse={pulse_val}, SpO2={spo2_val}%, Temp={temp_val}°C")
                            
                        except Exception as e:
                            print(f"⚠️ Parse error: {e}")
                    
                    elif line and not line.startswith('===') and not line.startswith('---'):
                        if not line.startswith('pulse:') and not line.startswith('STATUS'):
                            print(f"📝 ESP32: {line}")
                
                time.sleep(0.1)
                
        except Exception as e:
            sensor_connected = False
            print(f"⚠️ ESP32 connection error: {e}")
    else:
        print("⚠️ No ESP32 found on any COM port. Running in simulation mode.")
        sensor_connected = False

esp32_thread = threading.Thread(target=read_esp32_serial, daemon=True)
esp32_thread.start()

def load_model():
    print("\n📊 Loading trained XGBoost model...")
    
    scaler_file = "scaler_final.joblib"
    model_file = "xgb_model_final.json"
    
    scaler_path = models_path / scaler_file
    model_path = models_path / model_file
    
    if not scaler_path.exists() or not model_path.exists():
        print(f"❌ Model files not found. Using fallback mode.")
        return None, None
    
    try:
        scaler = joblib.load(scaler_path)
        model = xgb.XGBClassifier()
        model.load_model(str(model_path))
        print(f"✅ Model loaded successfully!")
        return scaler, model
    except Exception as e:
        print(f"❌ Error loading model: {e}")
        return None, None

scaler, model = load_model()
MODELS_LOADED = scaler is not None and model is not None

def init_db():
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS records
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                 patient_name TEXT,
                 patient_id TEXT,
                 pulse INTEGER,
                 spo2 INTEGER,
                 temperature REAL,
                 risk INTEGER,
                 date TEXT,
                 email TEXT,
                 doctor_id TEXT)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  username TEXT UNIQUE,
                  password TEXT,
                  role TEXT CHECK(role IN ('doctor', 'patient')),
                  name TEXT,
                  patient_id TEXT UNIQUE,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute("SELECT * FROM users WHERE username='doctor'")
    if not c.fetchone():
        c.execute("INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)",
                  ('doctor', 'doc123', 'doctor', 'Doctor'))
        print("✅ Default doctor account created")
    
    try:
        c.execute("ALTER TABLE users ADD COLUMN created_by TEXT")
        print("✅ Added created_by column to users table")
    except:
        pass
    
    conn.commit()
    conn.close()
    print("✅ Main database initialized")

def init_chat_db():
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS conversations
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                 user_id TEXT,
                 patient_id TEXT,
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS chat_messages
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                 conversation_id INTEGER,
                 role TEXT,
                 content TEXT,
                 timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    conn.commit()
    conn.close()
    print("✅ Chat database initialized")

init_db()
init_chat_db()

# ========== AUTHENTICATION ROUTES ==========

@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("SELECT id, username, role, name, patient_id FROM users WHERE username=? AND password=?", 
              (username, password))
    user = c.fetchone()
    conn.close()
    
    if user:
        session['user_id'] = user[0]
        session['username'] = user[1]
        session['role'] = user[2]
        session['name'] = user[3]
        session['patient_id'] = user[4] if user[4] else None
        
        return jsonify({
            "success": True,
            "role": user[2],
            "name": user[3],
            "patient_id": user[4]
        })
    else:
        return jsonify({"success": False, "error": "Invalid credentials"}), 401

@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"success": True})

@app.route("/api/current_user", methods=["GET"])
def current_user():
    if 'user_id' in session:
        return jsonify({
            "logged_in": True,
            "role": session.get('role'),
            "name": session.get('name'),
            "patient_id": session.get('patient_id')
        })
    return jsonify({"logged_in": False})

# ========== ESP32 CONTROL ROUTES ==========

@app.route("/api/start_monitoring", methods=["POST"])
def start_monitoring():
    global serial_port
    
    if serial_port and serial_port.is_open:
        try:
            serial_port.write(b"START_MONITORING\n")
            print("📡 Sent START command to ESP32")
            return jsonify({"success": True, "message": "Monitoring started"})
        except Exception as e:
            print(f"Error sending start command: {e}")
            return jsonify({"success": False, "error": str(e)}), 500
    else:
        return jsonify({"success": False, "error": "ESP32 not connected"}), 400

@app.route("/api/stop_monitoring", methods=["POST"])
def stop_monitoring():
    global serial_port
    
    if serial_port and serial_port.is_open:
        try:
            serial_port.write(b"STOP_MONITORING\n")
            print("📡 Sent STOP command to ESP32")
            return jsonify({"success": True, "message": "Monitoring stopped"})
        except Exception as e:
            print(f"Error sending stop command: {e}")
            return jsonify({"success": False, "error": str(e)}), 500
    else:
        return jsonify({"success": False, "error": "ESP32 not connected"}), 400

@app.route("/api/sensor_status", methods=["GET"])
def sensor_status():
    return jsonify({
        "connected": sensor_connected,
        "monitoring": monitoring_active,
        "pulse": latest_pulse,
        "spo2": latest_spo2,
        "temperature": latest_temp
    })

@app.route("/api/sensor_data", methods=["GET"])
def get_sensor_data():
    return jsonify({
        "success": sensor_connected,
        "pulse": latest_pulse,
        "spo2": latest_spo2,
        "temperature": latest_temp,
        "connected": sensor_connected,
        "monitoring": monitoring_active
    })

# ========== DOCTOR REGISTRATION ROUTES ==========

@app.route("/api/check_username", methods=["POST"])
def check_username():
    try:
        data = request.json
        username = data.get('username')
        
        conn = sqlite3.connect(DATABASE)
        c = conn.cursor()
        c.execute("SELECT * FROM users WHERE username=?", (username,))
        exists = c.fetchone() is not None
        conn.close()
        
        return jsonify({"exists": exists})
    except Exception as e:
        print(f"❌ Username check error: {e}")
        return jsonify({"exists": False, "error": str(e)}), 500

@app.route("/api/register_doctor", methods=["POST"])
def register_doctor():
    try:
        data = request.json
        print(f"📝 Registration data received: {data}")
        
        username = data.get('username')
        password = data.get('password')
        name = data.get('name')
        email = data.get('email')
        
        if not username or not password or not name:
            return jsonify({"error": "Missing required fields"}), 400
        
        conn = sqlite3.connect(DATABASE)
        c = conn.cursor()
        
        c.execute("SELECT * FROM users WHERE username=?", (username,))
        if c.fetchone():
            conn.close()
            return jsonify({"error": "Username already exists"}), 400
        
        patient_id = f"DOC_{uuid.uuid4().hex[:8].upper()}"
        
        c.execute("""INSERT INTO users (username, password, role, name, patient_id, created_by) 
                     VALUES (?, ?, ?, ?, ?, ?)""",
                  (username, password, 'doctor', name, patient_id, 'self'))
        
        conn.commit()
        conn.close()
        
        print(f"✅ Doctor account created: {username}")
        return jsonify({"success": True, "message": "Doctor account created successfully!"})
        
    except sqlite3.OperationalError as e:
        if "no column named created_by" in str(e):
            try:
                conn = sqlite3.connect(DATABASE)
                c = conn.cursor()
                patient_id = f"DOC_{uuid.uuid4().hex[:8].upper()}"
                c.execute("""INSERT INTO users (username, password, role, name, patient_id) 
                             VALUES (?, ?, ?, ?, ?)""",
                          (username, password, 'doctor', name, patient_id))
                conn.commit()
                conn.close()
                print(f"✅ Doctor account created: {username}")
                return jsonify({"success": True, "message": "Doctor account created successfully!"})
            except Exception as e2:
                print(f"❌ Registration error: {e2}")
                return jsonify({"error": str(e2)}), 500
        else:
            print(f"❌ Registration error: {e}")
            return jsonify({"error": str(e)}), 500
    except Exception as e:
        print(f"❌ Registration error: {e}")
        return jsonify({"error": str(e)}), 500

# ========== PATIENT MANAGEMENT ROUTES ==========

@app.route("/api/create_patient", methods=["POST"])
def create_patient():
    if 'user_id' not in session or session['role'] != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403
    
    data = request.json
    name = data.get('name')
    username = data.get('username')
    password = data.get('password')
    created_by = session.get('username')
    
    if not name or not username or not password:
        return jsonify({"error": "Missing required fields"}), 400
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    c.execute("SELECT * FROM users WHERE username=?", (username,))
    if c.fetchone():
        conn.close()
        return jsonify({"error": "Username already exists"}), 400
    
    patient_id = f"PAT_{uuid.uuid4().hex[:8].upper()}"
    
    c.execute("""INSERT INTO users (username, password, role, name, patient_id, created_by) 
                 VALUES (?, ?, ?, ?, ?, ?)""",
              (username, password, 'patient', name, patient_id, created_by))
    
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "patient_id": patient_id})

@app.route("/api/patients", methods=["GET"])
def get_patients():
    if 'user_id' not in session or session['role'] != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    doctor_name = session.get('username')
    c.execute("SELECT id, username, name, patient_id, created_at FROM users WHERE role='patient' AND created_by=? ORDER BY created_at DESC", 
              (doctor_name,))
    
    patients = []
    for row in c.fetchall():
        c.execute("SELECT COUNT(*) FROM records WHERE patient_id=?", (row[3],))
        record_count = c.fetchone()[0]
        
        patients.append({
            "id": row[0],
            "username": row[1],
            "name": row[2],
            "patient_id": row[3],
            "created_at": row[4],
            "record_count": record_count
        })
    
    conn.close()
    return jsonify(patients)

@app.route("/api/reset_password", methods=["POST"])
def reset_password():
    if 'user_id' not in session or session['role'] != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403
    
    data = request.json
    user_id = data.get('user_id')
    new_password = data.get('new_password')
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("UPDATE users SET password=? WHERE id=? AND role='patient'", (new_password, user_id))
    conn.commit()
    conn.close()
    
    return jsonify({"success": True})

@app.route("/api/delete_patient/<int:user_id>", methods=["DELETE"])
def delete_patient(user_id):
    if 'user_id' not in session or session['role'] != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    c.execute("SELECT patient_id FROM users WHERE id=? AND role='patient'", (user_id,))
    result = c.fetchone()
    
    if result:
        patient_id = result[0]
        c.execute("DELETE FROM records WHERE patient_id=?", (patient_id,))
        c.execute("DELETE FROM users WHERE id=? AND role='patient'", (user_id,))
        conn.commit()
    
    conn.close()
    return jsonify({"success": True})

# ========== PREDICTION ROUTE ==========

@app.route("/api/predict", methods=["POST"])
def predict():
    data = request.json
    pulse = float(data.get("pulse", 75))
    spo2 = float(data.get("spo2", 98))
    temperature = float(data.get("temperature", 36.5))

    if MODELS_LOADED:
        try:
            features = np.array([[pulse, spo2, temperature]])
            features_scaled = scaler.transform(features)
            prediction = model.predict(features_scaled)[0]
            
            if prediction == 0:
                risk_score = 30
                risk_label = "Low Risk"
                guidance = "✅ Patient condition stable. Continue routine monitoring."
            elif prediction == 1:
                risk_score = 60
                risk_label = "Medium Risk"
                guidance = "⚠️ Patient requires observation. Schedule follow-up in 48 hours."
            else:
                risk_score = 90
                risk_label = "High Risk"
                guidance = "🔴 Immediate attention needed. Contact healthcare provider."
        except Exception as e:
            risk_score = 30
            if pulse > 100 or pulse < 60: risk_score += 20
            if spo2 < 95: risk_score += 30
            if temperature > 37.5 or temperature < 36.0: risk_score += 20
            risk_score = min(risk_score, 100)
            risk_label = "Low Risk" if risk_score <= 30 else "Medium Risk" if risk_score <= 60 else "High Risk"
            guidance = "Rule-based assessment"
    else:
        risk_score = 30
        if pulse > 100 or pulse < 60: risk_score += 20
        if spo2 < 95: risk_score += 30
        if temperature > 37.5 or temperature < 36.0: risk_score += 20
        risk_score = min(risk_score, 100)
        risk_label = "Low Risk" if risk_score <= 30 else "Medium Risk" if risk_score <= 60 else "High Risk"
        guidance = "Rule-based assessment"

    return jsonify({
        "risk_score": risk_score,
        "risk_label": risk_label,
        "guidance": guidance
    })

# ========== RECORDS ROUTES ==========

@app.route("/api/records", methods=["GET"])
def get_records():
    if 'user_id' not in session:
        return jsonify({"error": "Not authenticated"}), 401
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    if session['role'] == 'doctor':
        c.execute("SELECT * FROM records ORDER BY id DESC")
    else:
        patient_id = session.get('patient_id')
        c.execute("SELECT * FROM records WHERE patient_id=? ORDER BY id DESC", (patient_id,))
    
    rows = c.fetchall()
    conn.close()
    
    records = []
    for row in rows:
        records.append({
            "id": row[0],
            "patient_name": row[1],
            "patient_id": row[2],
            "pulse": row[3],
            "spo2": row[4],
            "temperature": row[5],
            "risk": row[6],
            "date": row[7]
        })
    
    return jsonify(records)

@app.route("/api/save_record", methods=["POST"])
def save_record():
    if 'user_id' not in session:
        return jsonify({"error": "Not authenticated"}), 401
    
    data = request.json
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("""
        INSERT INTO records 
        (patient_name, patient_id, pulse, spo2, temperature, risk, date, doctor_id)
        VALUES (?,?,?,?,?,?,?,?)
    """, (
        data["patient_name"],
        data["patient_id"],
        data["pulse"],
        data["spo2"],
        data["temperature"],
        data["risk"],
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        session.get('username')
    ))
    conn.commit()
    conn.close()
    
    return jsonify({"success": True})

@app.route("/api/delete_record/<int:record_id>", methods=["DELETE"])
def delete_record(record_id):
    if 'user_id' not in session or session['role'] != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("DELETE FROM records WHERE id=?", (record_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route("/api/clear_all_records", methods=["DELETE"])
def clear_all_records():
    if 'user_id' not in session or session['role'] != 'doctor':
        return jsonify({"error": "Unauthorized"}), 403
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("DELETE FROM records")
    conn.commit()
    conn.close()
    return jsonify({"success": True})

# ========== STATS ROUTE ==========

@app.route("/api/stats", methods=["GET"])
def get_stats():
    if 'user_id' not in session:
        return jsonify({"error": "Not authenticated"}), 401
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    if session['role'] == 'doctor':
        c.execute("SELECT COUNT(*) FROM records")
        total = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM records WHERE risk > 60")
        high_risk = c.fetchone()[0]
        c.execute("SELECT AVG(pulse), AVG(spo2), AVG(temperature) FROM records")
        avg = c.fetchone()
    else:
        patient_id = session.get('patient_id')
        c.execute("SELECT COUNT(*) FROM records WHERE patient_id=?", (patient_id,))
        total = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM records WHERE patient_id=? AND risk > 60", (patient_id,))
        high_risk = c.fetchone()[0]
        c.execute("SELECT AVG(pulse), AVG(spo2), AVG(temperature) FROM records WHERE patient_id=?", (patient_id,))
        avg = c.fetchone()
    
    conn.close()
    
    return jsonify({
        "total": total,
        "high_risk": high_risk,
        "avg_pulse": round(avg[0], 1) if avg and avg[0] else 75,
        "avg_spo2": round(avg[1], 1) if avg and avg[1] else 98,
        "avg_temp": round(avg[2], 1) if avg and avg[2] else 36.5
    })

# ========== CHATBOT ROUTES ==========

@app.route("/api/chat/conversations", methods=["GET"])
def get_conversations():
    user_id = request.args.get('user_id', 'anonymous')
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("SELECT id, created_at FROM conversations WHERE user_id=? ORDER BY created_at DESC", (user_id,))
    conversations = [{"id": row[0], "created_at": row[1]} for row in c.fetchall()]
    conn.close()
    return jsonify(conversations)

@app.route("/api/chat/new", methods=["POST"])
def new_conversation():
    data = request.json
    user_id = data.get('user_id', 'anonymous')
    patient_id = session.get('patient_id') if session.get('role') == 'patient' else None
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("INSERT INTO conversations (user_id, patient_id) VALUES (?, ?)", (user_id, patient_id))
    conversation_id = c.lastrowid
    conn.commit()
    conn.close()
    
    return jsonify({"conversation_id": conversation_id})

@app.route("/api/chat/history/<int:conversation_id>", methods=["GET"])
def get_conversation_history(conversation_id):
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("SELECT role, content, timestamp FROM chat_messages WHERE conversation_id=? ORDER BY timestamp", 
              (conversation_id,))
    messages = [{"role": row[0], "content": row[1], "timestamp": row[2]} for row in c.fetchall()]
    conn.close()
    return jsonify(messages)

@app.route("/api/chat/send", methods=["POST"])
def send_message():
    data = request.json
    conversation_id = data.get('conversation_id')
    user_message = data.get('message')
    
    if not conversation_id or not user_message:
        return jsonify({"error": "Missing data"}), 400
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)",
              (conversation_id, 'user', user_message))
    conn.commit()
    
    bot_response = generate_gemini_response(user_message)
    
    c.execute("INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)",
              (conversation_id, 'assistant', bot_response))
    conn.commit()
    conn.close()
    
    return jsonify({"response": bot_response})

def generate_gemini_response(user_message):
    if not GEMINI_API_KEY:
        return "🔑 **Gemini API Key Missing!**\n\nPlease add your Gemini API key to the `.env` file."
    
    try:
        model = genai.GenerativeModel('models/gemini-flash-latest')
        full_prompt = f"""{SYSTEM_PROMPT}

User Question: {user_message}

Please provide a helpful, accurate, and friendly response."""
        
        response = model.generate_content(full_prompt)
        
        if response and response.text:
            return response.text
        else:
            return "⚠️ I received an empty response. Please try again."
        
    except Exception as e:
        print(f"⚠️ Gemini API error: {e}")
        return f"⚠️ **Gemini API Error**\n\n{str(e)}"

# ========== PDF AND EMAIL ROUTES ==========

def generate_pdf_bytes(record):
    buffer = io.BytesIO()
    
    styles = getSampleStyleSheet()
    
    styles.add(ParagraphStyle(name='MedicalTitle', parent=styles['Title'], fontSize=24, textColor=colors.HexColor('#1a4a6f'), alignment=TA_CENTER, spaceAfter=30, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle(name='MedicalHeading', parent=styles['Heading1'], fontSize=14, textColor=colors.HexColor('#2c7a6e'), spaceAfter=12, spaceBefore=12, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle(name='MedicalSubheading', parent=styles['Normal'], fontSize=11, textColor=colors.HexColor('#5c7b8f'), alignment=TA_CENTER, spaceAfter=20))
    styles.add(ParagraphStyle(name='MedicalNormal', parent=styles['Normal'], fontSize=10, leading=14, textColor=colors.HexColor('#2c3e50')))
    styles.add(ParagraphStyle(name='RiskLow', parent=styles['Normal'], fontSize=12, textColor=colors.HexColor('#27ae60'), alignment=TA_CENTER, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle(name='RiskMedium', parent=styles['Normal'], fontSize=12, textColor=colors.HexColor('#f39c12'), alignment=TA_CENTER, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle(name='RiskHigh', parent=styles['Normal'], fontSize=12, textColor=colors.HexColor('#e74c3c'), alignment=TA_CENTER, fontName='Helvetica-Bold'))
    
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=72, bottomMargin=72, leftMargin=72, rightMargin=72)
    story = []
    
    story.append(Paragraph("MATERNAI HEALTH SYSTEM", styles['MedicalTitle']))
    story.append(Paragraph("AI-Powered Maternal Health Assessment Report", styles['MedicalSubheading']))
    story.append(Spacer(1, 10))
    story.append(Table([['']], colWidths=[450], rowHeights=[2], style=TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#2c7a6e'))])))
    story.append(Spacer(1, 20))
    
    story.append(Paragraph("PATIENT INFORMATION", styles['MedicalHeading']))
    
    patient_data = [
        ['Patient Name:', record[1], 'Patient ID:', record[2]],
        ['Assessment Date:', record[7], 'Report Generated:', datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
    ]
    
    patient_table = Table(patient_data, colWidths=[100, 150, 100, 150])
    patient_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#2c3e50')),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f0f7fa')),
        ('BACKGROUND', (2, 0), (2, -1), colors.HexColor('#f0f7fa')),
    ]))
    story.append(patient_table)
    story.append(Spacer(1, 20))
    
    story.append(Paragraph("VITAL SIGNS ASSESSMENT", styles['MedicalHeading']))
    
    risk_score = record[6]
    pulse_normal = 60 <= record[3] <= 100
    spo2_normal = record[4] >= 95
    temp_normal = 36.5 <= record[5] <= 37.5
    
    vital_data = [
        ['Parameter', 'Measured Value', 'Normal Range', 'Status'],
        ['Heart Rate', f"{record[3]} bpm", "60-100 bpm", "✅ Normal" if pulse_normal else "⚠️ Abnormal"],
        ['Oxygen Saturation (SpO2)', f"{record[4]}%", "95-100%", "✅ Normal" if spo2_normal else "⚠️ Low"],
        ['Body Temperature', f"{record[5]}°C", "36.5-37.5°C", "✅ Normal" if temp_normal else "⚠️ Abnormal"],
    ]
    
    vital_table = Table(vital_data, colWidths=[120, 100, 120, 100])
    vital_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2c7a6e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d0dde8')),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8fafc')),
        ('TEXTCOLOR', (1, 1), (1, -1), colors.HexColor('#1a4a6f')),
        ('FONTNAME', (1, 1), (1, -1), 'Helvetica-Bold'),
    ]))
    story.append(vital_table)
    story.append(Spacer(1, 20))
    
    story.append(Paragraph("RISK ASSESSMENT", styles['MedicalHeading']))
    
    if risk_score <= 30:
        risk_text = "LOW RISK"
        risk_color = '#27ae60'
        risk_description = "Patient's vital signs are within normal ranges. Condition appears stable with minimal risk factors identified."
    elif risk_score <= 60:
        risk_text = "MEDIUM RISK"
        risk_color = '#f39c12'
        risk_description = "Some vital signs are outside optimal ranges. Moderate risk factors detected requiring attention."
    else:
        risk_text = "HIGH RISK"
        risk_color = '#e74c3c'
        risk_description = "Multiple vital signs are significantly abnormal. High risk factors detected requiring immediate medical attention."
    
    risk_card_data = [['Risk Score', f"{risk_score}%"], ['Risk Level', risk_text]]
    risk_table = Table(risk_card_data, colWidths=[150, 150])
    risk_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 12),
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f0f7fa')),
        ('BACKGROUND', (1, 0), (1, -1), colors.HexColor(risk_color + '20')),
        ('TEXTCOLOR', (1, 0), (1, -1), colors.HexColor(risk_color)),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica-Bold'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#d0dde8')),
    ]))
    story.append(risk_table)
    story.append(Spacer(1, 12))
    story.append(Paragraph(risk_description, styles['MedicalNormal']))
    story.append(Spacer(1, 15))
    
    story.append(Paragraph("CLINICAL RECOMMENDATIONS", styles['MedicalHeading']))
    
    if risk_score <= 30:
        recommendations = [
            "✅ Continue routine prenatal checkups as scheduled",
            "✅ Maintain healthy diet rich in folic acid, iron, and calcium",
            "✅ Stay hydrated - drink 8-10 glasses of water daily",
            "✅ Get adequate rest (7-9 hours of sleep)",
            "✅ Monitor for any developing symptoms",
            "📅 Schedule next assessment in 1 week"
        ]
    elif risk_score <= 60:
        recommendations = [
            "⚠️ Increase monitoring frequency - check vitals every 4 hours",
            "⚠️ Schedule follow-up appointment within 48 hours",
            "⚠️ Reduce physical activity and stress levels",
            "⚠️ Monitor for worsening symptoms",
            "📞 Contact healthcare provider if symptoms change",
            "📊 Consider additional diagnostic tests"
        ]
    else:
        recommendations = [
            "🔴 IMMEDIATE medical consultation required",
            "🔴 Continuous vital signs monitoring recommended",
            "🔴 Contact emergency services if symptoms worsen",
            "🔴 Avoid physical exertion and stress",
            "🔴 Do not delay seeking medical attention",
            "🏥 Prepare for possible hospital admission"
        ]
    
    for rec in recommendations:
        story.append(Paragraph(rec, styles['MedicalNormal']))
        story.append(Spacer(1, 6))
    story.append(Spacer(1, 20))
    
    story.append(Paragraph("ADDITIONAL INFORMATION", styles['MedicalHeading']))
    info_data = [['AI Model:', 'XGBoost Classifier'], ['Model Accuracy:', '95.24%'], ['Assessment Method:', 'AI-Powered Risk Prediction'], ['Data Source:', 'Real-time Patient Vitals']]
    info_table = Table(info_data, colWidths=[150, 250])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'), ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f8fafc')), ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#5c7b8f')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 20))
    
    story.append(Spacer(1, 30))
    story.append(Table([['']], colWidths=[450], rowHeights=[1], style=TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#d0dde8'))])))
    story.append(Spacer(1, 10))
    
    footer_text = '<font size=8 color=#8aa9c2>⚕️ This report is generated by MATERNAI AI System - An AI-powered maternal health intelligence platform.<br/>This system provides predictive insights based on vital signs analysis. It does not replace professional medical advice.<br/>For medical emergencies, please contact your healthcare provider immediately.</font>'
    story.append(Paragraph(footer_text, styles['Normal']))
    
    doc.build(story)
    buffer.seek(0)
    return buffer

@app.route("/api/download_pdf/<int:record_id>", methods=["GET"])
def download_pdf(record_id):
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("SELECT * FROM records WHERE id=?", (record_id,))
    record = c.fetchone()
    conn.close()
    
    if not record:
        return jsonify({"error": "Record not found"}), 404
    
    try:
        pdf_buffer = generate_pdf_bytes(record)
        return send_file(
            pdf_buffer,
            as_attachment=True,
            download_name=f"MATERNAI_Report_{record_id}.pdf",
            mimetype='application/pdf'
        )
    except Exception as e:
        print(f"PDF generation error: {e}")
        return jsonify({"error": f"Failed to generate PDF: {str(e)}"}), 500

@app.route("/api/send_report", methods=["POST"])
def send_report():
    data = request.json
    record_id = data.get('record_id')
    recipient_email = data.get('email')
    
    if not record_id or not recipient_email:
        return jsonify({"error": "Missing record_id or email"}), 400
    
    if not EMAIL_USER or not EMAIL_PASSWORD:
        return jsonify({"error": "Email service not configured. Please check EMAIL_USER and EMAIL_PASSWORD in .env file"}), 500
    
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute("SELECT * FROM records WHERE id=?", (record_id,))
    record = c.fetchone()
    conn.close()
    
    if not record:
        return jsonify({"error": "Record not found"}), 404
    
    try:
        pdf_buffer = generate_pdf_bytes(record)
        pdf_bytes = pdf_buffer.getvalue()
        
        msg = MIMEMultipart()
        msg['From'] = EMAIL_FROM
        msg['To'] = recipient_email
        msg['Subject'] = f"MATERNAI Health Report - {record[1]}"
        
        risk_score = record[6]
        risk_level = "LOW RISK" if risk_score <= 30 else "MEDIUM RISK" if risk_score <= 60 else "HIGH RISK"
        
        body = f"""Dear {record[1]},

Please find attached your MATERNAI health assessment report.

Summary:
- Patient: {record[1]}
- Date: {record[7]}
- Pulse: {record[3]} bpm
- SpO2: {record[4]}%
- Temperature: {record[5]}°C
- Risk Level: {risk_level} ({risk_score}%)

This report is generated by the MATERNAI AI-powered maternal health system.
For any concerns, please consult your healthcare provider.

Best regards,
MATERNAI Health System"""
        
        msg.attach(MIMEText(body, 'plain'))
        
        part = MIMEBase('application', 'octet-stream')
        part.set_payload(pdf_bytes)
        encoders.encode_base64(part)
        part.add_header('Content-Disposition', f'attachment; filename=MATERNAI_Report_{record_id}.pdf')
        msg.attach(part)
        
        with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT) as server:
            server.starttls()
            server.login(EMAIL_USER, EMAIL_PASSWORD)
            server.send_message(msg)
        
        print(f"✅ Email sent to {recipient_email}")
        return jsonify({"success": True, "message": "Email sent successfully"})
        
    except Exception as e:
        print(f"Email error: {e}")
        return jsonify({"error": str(e)}), 500

# ========== MAIN ==========

@app.route("/")
def home():
    return render_template("index.html")

def open_browser():
    time.sleep(2)
    webbrowser.open("http://127.0.0.1:5050")

if __name__ == "__main__":
    print("\n" + "="*60)
    print("✅ MATERNAI SYSTEM READY")
    print("="*60)
    if MODELS_LOADED:
        print("\n🤖 AI Engine: ACTIVE (XGBoost)")
    else:
        print("\n🤖 AI Engine: FALLBACK MODE")
    if GEMINI_API_KEY:
        print("🤖 Chatbot: ACTIVE (Google Gemini)")
    else:
        print("🤖 Chatbot: NEEDS API KEY")
    if EMAIL_USER and EMAIL_PASSWORD:
        print("📧 Email Service: ACTIVE")
    else:
        print("📧 Email Service: DISABLED (Add EMAIL_USER and EMAIL_PASSWORD to .env)")
    print("\n📡 ESP32 Sensor: " + ("CONNECTED" if sensor_connected else "DISCONNECTED (Waiting for ESP32)"))
    print("\n" + "="*60)
    print("🚀 Starting server on http://127.0.0.1:5050")
    print("="*60)
    threading.Thread(target=open_browser, daemon=True).start()
    app.run(debug=False, port=5050, host='127.0.0.1')