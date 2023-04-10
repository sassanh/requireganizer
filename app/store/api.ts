import { Configuration, OpenAIApi } from "openai";

console.log(process.env.NEXT_PUBLIC_OPENAI_API_KEY);
const configuration = new Configuration({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
});

const ai = new OpenAIApi(configuration);
export default ai;
