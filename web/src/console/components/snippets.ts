import type { CodeTab } from "./code-block";

export const KEY_PLACEHOLDER = "sk-xxxxxxxx";

export function curlOpenAI(base: string, model: string, key = KEY_PLACEHOLDER) {
  return `curl ${base}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "你好，请介绍一下你自己"}],
    "stream": false
  }'`;
}

export function curlAnthropic(base: string, model: string, key = KEY_PLACEHOLDER) {
  return `curl ${base}/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${key}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "${model}",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好，请介绍一下你自己"}]
  }'`;
}

export function curlEmbeddings(base: string, model: string, key = KEY_PLACEHOLDER) {
  return `curl ${base}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{"model": "${model}", "input": "要向量化的文本"}'`;
}

export function pythonOpenAI(base: string, model: string, key = KEY_PLACEHOLDER) {
  return `from openai import OpenAI

client = OpenAI(
    base_url="${base}/v1",
    api_key="${key}",
)

stream = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "你好，请介绍一下你自己"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)`;
}

export function nodeOpenAI(base: string, model: string, key = KEY_PLACEHOLDER) {
  return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${base}/v1",
  apiKey: "${key}",
});

const completion = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "你好，请介绍一下你自己" }],
});

console.log(completion.choices[0].message.content);`;
}

export function pythonAnthropic(base: string, model: string, key = KEY_PLACEHOLDER) {
  return `import anthropic

client = anthropic.Anthropic(
    base_url="${base}",
    api_key="${key}",
)

message = client.messages.create(
    model="${model}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "你好，请介绍一下你自己"}],
)
print(message.content[0].text)`;
}

export function claudeCodeEnv(base: string, key = KEY_PLACEHOLDER) {
  return `# macOS / Linux：写入 ~/.zshrc 或 ~/.bashrc
export ANTHROPIC_BASE_URL="${base}"
export ANTHROPIC_AUTH_TOKEN="${key}"

# 启动 Claude Code
claude

# Windows PowerShell
# $env:ANTHROPIC_BASE_URL="${base}"
# $env:ANTHROPIC_AUTH_TOKEN="${key}"`;
}

/** 模型详情中的代码示例 */
export function modelTabs(base: string, model: string, endpoints: string[], mode: string): CodeTab[] {
  if (mode === "embedding" || endpoints.includes("embeddings") && !endpoints.includes("openai")) {
    return [{ key: "curl", label: "cURL", code: curlEmbeddings(base, model) }];
  }
  const tabs: CodeTab[] = [
    { key: "curl", label: "cURL", code: curlOpenAI(base, model) },
    { key: "python", label: "Python (OpenAI SDK)", code: pythonOpenAI(base, model) },
    { key: "node", label: "Node.js", code: nodeOpenAI(base, model) },
  ];
  if (endpoints.includes("anthropic")) {
    tabs.push({ key: "anthropic", label: "Anthropic 格式", code: curlAnthropic(base, model) });
    tabs.push({ key: "anthropic-py", label: "Anthropic SDK", code: pythonAnthropic(base, model) });
  }
  return tabs;
}
