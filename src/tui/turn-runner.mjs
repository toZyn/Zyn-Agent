export async function runSerialInputs({ store, firstInput, execute, onError }) {
  if (store.processing) {
    store.enqueueMessage(firstInput);
    return false;
  }
  store.processing = true;
  store._emit();
  try {
    let input = firstInput;
    while (input !== undefined && !store.pendingExit) {
      try {
        await execute(input);
      } catch (error) {
        onError(error, input);
      }
      if (store.pendingExit) break;
      input = store.messageQueue.shift();
    }
  } finally {
    store.processing = false;
    store._emit();
  }
  return true;
}
