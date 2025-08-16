import crypto from 'crypto';

function verifyHmac(payload, signature, secret) {
  const hash = crypto.createHmac('sha256', secret)
                     .update(JSON.stringify(payload))
                     .digest('hex');
  return hash === signature;
}

export default verifyHmac;