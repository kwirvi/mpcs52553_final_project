import os 
import sqlite3
import secrets
from flask import Flask, request, g, send_from_directory, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

app = Flask(__name__, static_folder='static', static_url_path='')

DATABASE = os.path.join(os.path.dirname(__file__), 'db', 'belay.sqlite3') 
sessions = {}

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def create_session(user_id):
    token = secrets.token_hex(32)
    sessions[token] = user_id
    return token

def get_user_id_from_token():
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer "):]
        return sessions.get(token)
    return None

def require_auth():
    user_id = get_user_id_from_token()
    if user_id is None:
        return jsonify({"error": "Not authenticated"}), 401
    return user_id

def channel_unread_counts(user_id):
    # Returns a dict {channel_id: unread_count, ...}
    # unread_count = total messages in channel - messages read
    db = get_db()
    query = """
    SELECT c.id as channel_id,
           (SELECT COUNT(*) FROM messages m 
            WHERE m.channel_id = c.id
            AND (m.id > COALESCE(ucr.last_read_message_id, 0))) as unread_count
    FROM channels c
    LEFT JOIN user_channel_reads ucr ON ucr.channel_id = c.id AND ucr.user_id = ?
    """
    counts = {}
    for row in db.execute(query, (user_id,)):
        counts[row["channel_id"]] = row["unread_count"]
    return counts

def update_last_read(user_id, channel_id, message_id):
    db = get_db()
    # Insert or update the last_read_message_id for this user/channel
    db.execute("""
        INSERT INTO user_channel_reads (user_id, channel_id, last_read_message_id)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id
    """, (user_id, channel_id, message_id))
    db.commit()



@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def static_proxy(path):
    return send_from_directory(app.static_folder, path)


# ---------------------- API Routes --------------------------------------------- #

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Missing username or password"}), 400

    username = data['username'].strip()
    password = data['password']

    if username == "" or password == "":
        return jsonify({"error": "Username and password cannot be empty"}), 400

    db = get_db()
    # Check if username already exists
    row = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if row:
        return jsonify({"error": "Username already taken"}), 400

    pw_hash = generate_password_hash(password)
    db.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (username, pw_hash))
    db.commit()
    return jsonify({"success": True}), 200

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Missing username or password"}), 400

    username = data['username']
    password = data['password']
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if user and check_password_hash(user['password_hash'], password):
        token = create_session(user['id'])
        return jsonify({"success": True, "token": token}), 200
    else:
        return jsonify({"error": "Invalid username or password"}), 401

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    user_id = get_user_id_from_token()
    if user_id is None:
        # Not logged in anyway
        return jsonify({"success": True}), 200
    # Find the token and remove it
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer "):]
        sessions.pop(token, None)
    return jsonify({"success": True}), 200


@app.route('/api/users/update_username', methods=['POST'])
def update_username():
    user_id = require_auth()
    if isinstance(user_id, tuple):
        return user_id  # error response

    data = request.get_json()
    if not data or 'new_username' not in data:
        return jsonify({"error": "Missing new_username"}), 400

    new_username = data['new_username'].strip()
    if new_username == "":
        return jsonify({"error": "Username cannot be empty"}), 400

    db = get_db()
    # Check if username exists
    exists = db.execute("SELECT id FROM users WHERE username = ?", (new_username,)).fetchone()
    if exists:
        return jsonify({"error": "Username already taken"}), 400

    db.execute("UPDATE users SET username = ? WHERE id = ?", (new_username, user_id))
    db.commit()
    return jsonify({"success": True}), 200

@app.route('/api/users/update_password', methods=['POST'])
def update_password():
    user_id = require_auth()
    if isinstance(user_id, tuple):
        return user_id  # error response

    data = request.get_json()
    if not data or 'new_password' not in data:
        return jsonify({"error": "Missing new_password"}), 400

    new_password = data['new_password']
    if new_password == "":
        return jsonify({"error": "Password cannot be empty"}), 400

    pw_hash = generate_password_hash(new_password)
    db = get_db()
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (pw_hash, user_id))
    db.commit()
    return jsonify({"success": True}), 200


@app.route('/api/channels', methods=['GET'])
def get_channels():
    user_id = require_auth()
    if isinstance(user_id, tuple):
        return user_id

    db = get_db()
    channels = db.execute("SELECT * FROM channels").fetchall()
    unread = channel_unread_counts(user_id)
    result = []
    for c in channels:
        result.append({
            "id": c["id"],
            "name": c["name"],
            "unread_count": unread.get(c["id"], 0)
        })
    return jsonify(result), 200

@app.route('/api/channels', methods=['POST'])
def create_channel():
    user_id = require_auth()
    if isinstance(user_id, tuple):
        return user_id

    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({"error": "Missing channel name"}), 400

    name = data['name'].strip()
    if name == "":
        return jsonify({"error": "Channel name cannot be empty"}), 400

    db = get_db()
    # Check if channel name exists
    existing = db.execute("SELECT id FROM channels WHERE name = ?", (name,)).fetchone()
    if existing:
        return jsonify({"error": "Channel name already exists"}), 400

    db.execute("INSERT INTO channels (name) VALUES (?)", (name,))
    db.commit()
    return jsonify({"success": True}), 200


@app.route('/api/unread', methods=['GET'])
def get_unread():
    user_id = require_auth()
    if isinstance(user_id, tuple):
        return user_id

    unread = channel_unread_counts(user_id)
    return jsonify(unread), 200


@app.route('/api/messages', methods=['GET'])
def get_messages():
    user_id = require_auth()
    if isinstance(user_id, tuple):
        return user_id

    channel_id = request.args.get('channel_id')
    if channel_id is None:
        return jsonify({"error": "channel_id is required"}), 400

    db = get_db()
    # Check if channel exists
    ch = db.execute("SELECT id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if not ch:
        return jsonify({"error": "Channel not found"}), 404

    # User must be authenticated. No private channels, so all authenticated users can see all channels. 
    # Get messages that belong to this channel and are not replies + count of replies
    messages = db.execute("""
        SELECT m.id, m.content, m.user_id, u.username, m.timestamp,
               (SELECT COUNT(*) FROM messages r WHERE r.replies_to = m.id) as reply_count
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.channel_id = ? AND m.replies_to IS NULL
        ORDER BY m.timestamp ASC
    """, (channel_id,)).fetchall()

    # Update last_read for user: mark all as read (the last message)
    # If there are messages, find the max message id as the last read
    if messages:
        last_msg_id = messages[-1]["id"]
        update_last_read(user_id, ch["id"], last_msg_id)

    result = []
    for msg in messages:
        # Get reactions for each message
        reactions = db.execute("""
            SELECT r.emoji, u.username
            FROM reactions r
            JOIN users u ON r.user_id = u.id
            WHERE r.message_id = ?
        """, (msg["id"],)).fetchall()
        # group by emoji
        reaction_map = {}
        for r in reactions:
            if r["emoji"] not in reaction_map:
                reaction_map[r["emoji"]] = []
            reaction_map[r["emoji"]].append(r["username"])

        result.append({
            "id": msg["id"],
            "content": msg["content"],
            "user_id": msg["user_id"],
            "username": msg["username"],
            "timestamp": msg["timestamp"],
            "reply_count": msg["reply_count"],
            "reactions": reaction_map
        })

    return jsonify(result), 200

@app.route('/api/messages', methods=['POST'])
def post_message():
    user_id = require_auth()
    if isinstance(user_id, tuple):
        return user_id

    data = request.get_json()
    if not data or 'channel_id' not in data or 'content' not in data:
        return jsonify({"error": "channel_id and content are required"}), 400

    channel_id = data['channel_id']
    content = data['content'].strip()
    replies_to = data.get('replies_to')

    if content == "":
        return jsonify({"error": "Message content cannot be empty"}), 400

    db = get_db()
    ch = db.execute("SELECT id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if not ch:
        return jsonify({"error": "Channel not found"}), 404

    # If replies_to is set, ensure that message exists
    if replies_to:
        parent = db.execute("SELECT id FROM messages WHERE id = ?", (replies_to,)).fetchone()
        if not parent:
            return jsonify({"error": "Parent message not found"}), 404

    db.execute("INSERT INTO messages (channel_id, user_id, content, replies_to) VALUES (?, ?, ?, ?)",
               (channel_id, user_id, content, replies_to))
    db.commit()

    # Get the inserted message id
    msg_id = db.execute("SELECT last_insert_rowid() as id").fetchone()['id']
    # Update last read for user
    update_last_read(user_id, channel_id, msg_id)

    return jsonify({"success": True, "message_id": msg_id}), 200

@app.route('/api/messages/thread', methods=['GET'])
def get_thread():
    user_id = require_auth()
    if isinstance(user_id, tuple):
        return user_id

    parent_id = request.args.get('parent_id')
    if parent_id is None:
        return jsonify({"error": "parent_id is required"}), 400

    db = get_db()
    # Get the parent message
    parent = db.execute("""
        SELECT m.id, m.content, m.user_id, u.username, m.channel_id, m.timestamp
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.id = ?
    """, (parent_id,)).fetchone()
    if not parent:
        return jsonify({"error": "Parent message not found"}), 404

    # Get the replies
    replies = db.execute("""
        SELECT m.id, m.content, m.user_id, u.username, m.timestamp
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.replies_to = ?
        ORDER BY m.timestamp ASC
    """, (parent_id,)).fetchall()

    # Mark last reply as read if any
    # If replies are present, mark last as read:
    if replies:
        last_reply_id = replies[-1]["id"]
        update_last_read(user_id, parent["channel_id"], last_reply_id)
    else:
        # No replies, at least mark parent as read
        update_last_read(user_id, parent["channel_id"], parent["id"])

    # Gather reactions for parent and replies
    def get_reactions_for_message(mid):
        rset = db.execute("""
            SELECT r.emoji, u.username
            FROM reactions r
            JOIN users u ON r.user_id = u.id
            WHERE r.message_id = ?
        """, (mid,)).fetchall()
        reaction_map = {}
        for r in rset:
            if r["emoji"] not in reaction_map:
                reaction_map[r["emoji"]] = []
            reaction_map[r["emoji"]].append(r["username"])
        return reaction_map

    parent_reactions = get_reactions_for_message(parent["id"])
    replies_result = []
    for rpl in replies:
        replies_result.append({
            "id": rpl["id"],
            "content": rpl["content"],
            "user_id": rpl["user_id"],
            "username": rpl["username"],
            "timestamp": rpl["timestamp"],
            "reactions": get_reactions_for_message(rpl["id"])
        })

    result = {
        "parent": {
            "id": parent["id"],
            "content": parent["content"],
            "user_id": parent["user_id"],
            "username": parent["username"],
            "timestamp": parent["timestamp"],
            "channel_id": parent["channel_id"],
            "reactions": parent_reactions
        },
        "replies": replies_result
    }
    return jsonify(result), 200


@app.route('/api/messages/read', methods=['POST'])
def mark_read():
    user_id = require_auth()
    if isinstance(user_id, tuple):
        return user_id

    data = request.get_json()
    if not data or 'channel_id' not in data or 'message_id' not in data:
        return jsonify({"error": "channel_id and message_id are required"}), 400

    channel_id = data["channel_id"]
    message_id = data["message_id"]

    db = get_db()
    # Check if message_id in that channel
    msg = db.execute("SELECT id FROM messages WHERE id = ? AND channel_id = ?", (message_id, channel_id)).fetchone()
    if not msg:
        return jsonify({"error": "Message not found in that channel"}), 404

    update_last_read(user_id, channel_id, message_id)
    return jsonify({"success": True}), 200


@app.route('/api/reactions', methods=['POST'])
def add_reaction():
    user_id = require_auth()
    if isinstance(user_id, tuple):
        return user_id

    data = request.get_json()
    if not data or 'message_id' not in data or 'emoji' not in data:
        return jsonify({"error": "message_id and emoji are required"}), 400

    message_id = data["message_id"]
    emoji = data["emoji"].strip()

    if emoji == "":
        return jsonify({"error": "Emoji cannot be empty"}), 400

    db = get_db()
    # Check message existence
    msg = db.execute("SELECT id, channel_id FROM messages WHERE id = ?", (message_id,)).fetchone()
    if not msg:
        return jsonify({"error": "Message not found"}), 404

    # Insert reaction
    db.execute("INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)", (message_id, user_id, emoji))
    db.commit()

    # Mark channel as read up to this message, perhaps
    update_last_read(user_id, msg["channel_id"], msg["id"])

    return jsonify({"success": True}), 200


if __name__ == '__main__':
    # Make sure the database file exists
    if not os.path.exists(DATABASE):
        open(DATABASE, 'w').close()
        # Need to have run migrations already.

    app.run(host='0.0.0.0', port=5000, debug=True)
