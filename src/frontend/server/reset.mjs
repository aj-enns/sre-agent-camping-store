try {
  const response = await fetch('http://127.0.0.1:8081/reset', {
    method: 'POST', headers: { 'X-Demo-Control': 'local-reset' }, signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  console.log(`${result.message} Session: ${result.sessionId}`);
} catch (error) {
  console.error(`Reset failed: ${error.message}`);
  process.exitCode = 1;
}
