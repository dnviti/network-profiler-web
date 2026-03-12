# Network Profiler

A continuous network monitoring tool with a live, real-time HTML dashboard. 

Network Profiler tracks latency, packet loss, jitter, DNS resolution times, throughput, and disconnection events. It runs a FastAPI server with WebSocket push, updating a beautiful Chart.js-based dashboard in real time without page reloads. When the script is stopped, it automatically bakes the collected data into a static HTML snapshot for offline review and sharing.

## Features

- **Ping Latency & Packet Loss:** Monitors specified targets (or automatically detects your gateway) for latency, jitter, and rolling packet loss.
- **DNS Resolution:** Measures DNS resolution time for configurable domains.
- **Throughput:** Tracks network throughput (upload/download rates) and dropped/error packets across all network interfaces.
- **Real-time Dashboard:** A modern, dark-themed web dashboard powered by Chart.js.
- **Offline HTML Snapshots:** Automatically saves a standalone HTML file with all the collected data upon shutdown.
- **Systemd Service Integration:** Includes a deployment script to run the profiler as a background systemd service.
- **SQLite Database:** All measurements are persisted to an SQLite database (`network_profile.db`).

## Requirements

- Python 3.10+
- `ping` command (standard on Linux/macOS)
- `ip` command (for default gateway detection on Linux)

## Installation

1. Clone the repository and navigate to the directory:
   ```bash
   cd network-profiler
   ```

2. Install the required Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
   *(Dependencies include `fastapi`, `uvicorn`, and `psutil`)*

## Usage

Run the script directly from your terminal. Press `Ctrl+C` to stop the profiler and generate the static HTML report.

```bash
# Run with default settings (auto-detects gateway, tests common DNS, runs until Ctrl-C)
python3 network_profiler.py

# Run for a specific duration
python3 network_profiler.py --duration 30m
python3 network_profiler.py --duration 2h

# Ping more frequently (every 1 second)
python3 network_profiler.py --interval 1

# Specify custom targets to ping
python3 network_profiler.py --targets 1.1.1.1 8.8.8.8 github.com

# Specify custom DNS domains to resolve
python3 network_profiler.py --dns-domains example.com mydomain.org

# Change the output HTML file name
python3 network_profiler.py --output my_custom_report.html

# Run the web dashboard on a custom port
python3 network_profiler.py --port 8050
```

Once running, open your browser and navigate to the dashboard. The startup banner shows the actual URL(s). By default the server listens on port **8065** on all network interfaces, so you can access it from any machine on the same network at `http://<machine-ip>:8065`.

## Systemd Service Management

A convenience script (`service.sh`) is provided to easily install, manage, and uninstall Network Profiler as a systemd service on Linux.

```bash
# Install and start the service
sudo ./service.sh install

# Install with custom options
sudo ./service.sh install --port 9000 --interval 1 --targets "1.1.1.1 8.8.8.8"

# Check the status of the service
./service.sh status

# Stop the service, clear the database and HTML snapshot, and restart
sudo ./service.sh reset

# Uninstall the service (use --purge to also delete the database and HTML snapshot)
sudo ./service.sh uninstall --purge
```

When installed via `service.sh`, the application data (database and HTML report) is stored in `/var/lib/network-profiler` and the configuration is saved to `/etc/sysconfig/network-profiler`.

### Network Access

The web dashboard is accessible from any machine on the local network.
When installed as a systemd service, `service.sh` automatically configures the firewall:

- **Install:** Opens the configured port in `firewalld` (if active).
- **Uninstall:** Closes the port in `firewalld`.

If your system does not use `firewalld`, open the port manually:

```bash
sudo iptables -A INPUT -p tcp --dport 8065 -j ACCEPT
```

To find your machine's IP address:

```bash
hostname -I
```

Then access the dashboard from another machine at `http://<your-ip>:8065`.
