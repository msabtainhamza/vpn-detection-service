# VPN Detection Service

A Node.js service for detecting **VPNs, proxies, and suspicious IP addresses**, with support for browser fingerprinting and database synchronization.

## Features

* VPN detection
* Proxy detection
* IP intelligence
* Browser fingerprinting
* Suspicious connection detection
* Database synchronization
* Automatic database updates
* REST API
* Node.js ES Modules support

## Tech Stack

* Node.js
* JavaScript
* REST API
* PostgreSQL
* Browser Fingerprinting
* IP Intelligence

## Getting Started

### Requirements

* Node.js 18+
* npm
* PostgreSQL

### Installation

```bash
git clone https://github.com/msabtainhamza/vpn-detection-service.git
cd vpn-detection-service
npm install
```

### Environment Variables

Create a `.env` file in the project root and configure the required environment variables:

```env
PORT=3000
DATABASE_URL=your_database_url
```

### Run the Service

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

## Available Scripts

| Command             | Description                     |
| ------------------- | ------------------------------- |
| `npm start`         | Start the service               |
| `npm run dev`       | Start the service in watch mode |
| `npm run sync`      | Synchronize the database        |
| `npm run update-db` | Update the detection database   |

## API

The service can be integrated into applications that need to identify potentially risky connections, including:

* VPN users
* Proxy users
* Automated traffic
* Suspicious sessions
* Fraud-prone requests

## Project Structure

```text
vpn-detection-service/
├── scripts/
│   ├── sync-database.js
│   └── updateDatabase.js
├── server.js
├── package.json
└── README.md
```
