function verifyHmac(payload, signature, secret) {
  const crypto = require('crypto');
  const digest = 'sha256=' + crypto.createHmac('sha256', secret)
                        .update(JSON.stringify(payload))
                        .digest('hex');
  return signature === digest;
}

export default verifyHmac;