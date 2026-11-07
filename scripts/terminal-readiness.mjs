export async function waitForRawModeReady(wait, refreshRecords, observed) {
  await wait('raw-mode readiness', async () => {
    await refreshRecords();
    return observed.some(event => event.type === 'raw' && event.actual === true);
  });
}
