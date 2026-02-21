import webview
import multiprocessing
import threading
import uvicorn
import time
import requests
import sys
import os

# Ensure the backend directory is in the path for imports when packaged
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.main import app

def run_server():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

def check_server_ready(url, timeout=30):
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            r = requests.get(url)
            if r.status_code < 500:
                return True
        except requests.ConnectionError:
            pass
        time.sleep(0.5)
    return False

if __name__ == "__main__":
    # Required for PyInstaller multiprocessing on macOS/Windows
    multiprocessing.freeze_support()
    
    server_url = "http://127.0.0.1:8000"
    
    # Start the FastAPI server in a background thread
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    
    # Wait for the backend to initialize
    if not check_server_ready(server_url):
        print(f"Error: Backend server did not start in time. Check logs.", file=sys.stderr)
        sys.exit(1)
    
    # Create the native window, passing the server URL
    webview.create_window("Oligool", server_url, width=1280, height=800, min_size=(800, 600))
    
    # Start the application loop (blocks until the window is closed)
    webview.start()
