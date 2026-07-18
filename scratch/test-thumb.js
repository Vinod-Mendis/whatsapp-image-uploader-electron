const sharp = require('sharp');
const os = require('os');
const path = require('path');
async function test() {
  const filePath = '/Users/ravindusankalpa/Desktop/flyxto/test-img/KOME/BDP0485858878.JPG';
  const thumbPath = path.join(os.homedir(), 'Library/Application Support/film-upload-app/thumb_test.jpg');
  await sharp(filePath).rotate().resize(300, 300, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(thumbPath);
  console.log('Thumbnail generated');
}
test().catch(console.error);
