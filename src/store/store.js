// Where agent runs and JBP packages are kept: a Cloud Storage bucket when BUCKET is set,
// otherwise a local ./data folder (for development and tests).
const fs = require('fs');
const path = require('path');

function localStore(root = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data')) {
  return {
    kind: 'local',
    async put(key, obj) {
      const f = path.join(root, key);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(obj, null, 2));
    },
    async get(key) {
      const f = path.join(root, key);
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    },
    async list(prefix) {
      const d = path.join(root, prefix);
      return fs.existsSync(d) ? fs.readdirSync(d).map(n => prefix + n) : [];
    }
  };
}

function gcsStore(bucketName) {
  const { Storage } = require('@google-cloud/storage');
  const bucket = new Storage().bucket(bucketName);
  return {
    kind: 'gcs',
    async put(key, obj) {
      await bucket.file(key).save(JSON.stringify(obj, null, 2), { contentType: 'application/json', resumable: false });
    },
    async get(key) {
      const f = bucket.file(key);
      const [exists] = await f.exists();
      if (!exists) return null;
      const [buf] = await f.download();
      return JSON.parse(buf.toString('utf8'));
    },
    async list(prefix) {
      const [files] = await bucket.getFiles({ prefix });
      return files.map(f => f.name);
    }
  };
}

function makeStore() {
  return process.env.BUCKET ? gcsStore(process.env.BUCKET) : localStore();
}

module.exports = { makeStore, localStore };
