const sharp = require('sharp');
const path = require('path');

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'public', 'screenshots');

// Ensure screenshots directory exists
const fs = require('fs');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function generatePlaceholderScreenshot() {
  console.log('Generating placeholder dashboard screenshot...');

  // Create a 1280x720 placeholder image with SYNCRO branding
  const width = 1280;
  const height = 720;

  // Create SVG content for the placeholder
  const svgContent = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#0f0f0f;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#1a1a1a;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <text x="50%" y="40%" font-family="Arial, sans-serif" font-size="48" fill="#6366f1" text-anchor="middle" font-weight="bold">SYNCRO</text>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="24" fill="#ffffff" text-anchor="middle">Subscription Manager</text>
      <text x="50%" y="60%" font-family="Arial, sans-serif" font-size="18" fill="#888888" text-anchor="middle">Dashboard Preview</text>
      <rect x="10%" y="70%" width="80%" height="20%" fill="#2a2a2a" rx="8"/>
      <text x="50%" y="78%" font-family="Arial, sans-serif" font-size="16" fill="#ffffff" text-anchor="middle">Sample Subscription Cards</text>
      <text x="50%" y="85%" font-family="Arial, sans-serif" font-size="14" fill="#666666" text-anchor="middle">@syncro/client — Dashboard Preview</text>
    </svg>
  `;

  const outputPath = path.join(SCREENSHOTS_DIR, 'dashboard.png');

  await sharp(Buffer.from(svgContent))
    .png()
    .toFile(outputPath);

  console.log('Generated placeholder dashboard screenshot: dashboard.png');
  console.log('Note: Replace with actual dashboard screenshot for production PWA');
}

generatePlaceholderScreenshot().catch(console.error);