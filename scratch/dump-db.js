const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://flyxtodev:4yjeGuUlhFdknAFd@flyxtocluster.9tkxm7x.mongodb.net/?retryWrites=true&w=majority&appName=FlyxtoCluster";

async function dump() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  
  console.log("=== CONFIG ===");
  const configs = await db.collection('event_config').find({}).toArray();
  console.log(JSON.stringify(configs, null, 2));

  console.log("\n=== LATEST USERS ===");
  const users = await db.collection('photobooth_users').find({}).sort({ createdAt: -1 }).limit(10).toArray();
  console.log(JSON.stringify(users, null, 2));

  await client.close();
}

dump().catch(console.error);
