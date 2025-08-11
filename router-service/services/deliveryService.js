import fetch from 'node-fetch';

export async function deliverToDestinations(payload, rules) {
  const tasks = rules.map(rule =>
    fetch(rule.destination_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  );
  await Promise.all(tasks);
}
