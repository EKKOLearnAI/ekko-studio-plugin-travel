import { validateModel } from '../sdk/harness/contracts.mjs'
import { runGuide } from './guides.mjs'
import { recognizeGuideImage } from './guide-ocr.mjs'
export function registerGuideTools(ctx, contract) {
  for (const name of ['search_guides', 'read_guide', 'recognize_guide_image']) {
    const definition = contract.tools[name]
    ctx.extensions.tools.register({ name, description: definition.description, readOnly: false, inputSchema: contract.models[definition.input],
      async execute(input, run) {
        try {
          validateModel(contract, definition.input, input)
          const data = name === 'recognize_guide_image' ? await recognizeGuideImage(input, run, contract) : await runGuide(name, input, run, contract)
          const ok = ['ok','partial','empty'].includes(data.status)
          return validateModel(contract, definition.output, { ok, content: JSON.stringify(data), data, ...(!ok ? { error: data.message } : {}) })
        } catch { return validateModel(contract, definition.output, { ok: false, content: '攻略操作输入或输出不符合契约，请核对参数。', error: '攻略操作输入或输出不符合契约，请核对参数。' }) }
      },
    })
  }
}
