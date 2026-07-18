const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db();
    const configCol = db.collection('event_config');
    
    // Print all documents
    const docs = await configCol.find({}).toArray();
    console.log('DOCUMENTS IN event_config COLLECTION:');
    console.log(JSON.stringify(docs, null, 2));

    // Delete any documents with empty or missing values
    const result = await configCol.deleteMany({
      $or: [
        { eventPrefix: { $in: [null, "", " ", undefined] } },
        { eventName: { $in: [null, "", " ", undefined] } },
        { _id: { $in: [null, "", " ", undefined] } }
      ]
    });
    console.log(`\nDeleted ${result.deletedCount} invalid documents.`);
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
