const { createHash } = require('node:crypto');
function isToolStepLimitReached(step,maxSteps) {
  return Number.isFinite(maxSteps) && maxSteps > 0 && step >= maxSteps;
}
class ToolProgressGuard {
  constructor(repetitions=8) {
    this.repetitions = Math.max(2,Math.floor(repetitions));
    this.last = '';
    this.count = 0;
  }
  observe(call,result) {
    const key = JSON.stringify({ tool:call?.tool, args:call?.args });
    const digest = createHash('sha256').update(key).update('\0').update(String(result)).digest('hex');
    this.count = digest === this.last ? this.count+1 : 1;
    this.last = digest;
    return this.count >= this.repetitions;
  }
}
module.exports={isToolStepLimitReached,ToolProgressGuard};
