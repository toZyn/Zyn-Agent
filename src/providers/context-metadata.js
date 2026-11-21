function contextFromProviderModel(model = {}) {
  const values = [model.context_window, model.context_length, model.max_context_length, model.max_input_tokens, model.input_token_limit];
  for (const value of values) {
    const num = Number(value);
    if (Number.isSafeInteger(num) && num > 0) return {contextLength:num};
  }
  return {};
}
module.exports={contextFromProviderModel};
