import { openai } from "@ai-sdk/openai";
import { DataAPIClient } from "@datastax/astra-db-ts";
import { streamText } from "ai";
import { OpenAI } from "openai";

const {
  ASTRA_DB_NAMESPACE,
  ASTRA_DB_COLLECTION,
  ASTRA_DB_API_ENDPOINT,
  ASTRA_DB_APPLICATION_TOKEN,
  OPENAI_API_KEY,
} = process.env;

const openAIClient = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN);
const db = client.db(ASTRA_DB_API_ENDPOINT!, { keyspace: ASTRA_DB_NAMESPACE });

export async function POST(req: Request) {
  const { messages } = await req.json();
  const latestMessage = messages[messages.length - 1]?.content;

  let docContext = "";

  const embeddings = await openAIClient.embeddings.create({
    model: "text-embedding-3-small",
    input: latestMessage,
    encoding_format: "float",
  });

  const collection = db.collection(ASTRA_DB_COLLECTION!);
  const cursor = collection.find(
    {},
    {
      sort: {
        $vector: embeddings.data[0].embedding,
      },
      limit: 10,
    },
  );

  const documents = await cursor.toArray();

  for await (const document of documents) {
    docContext += document.text + " ";
  }

  const template = {
    role: "system",
    content: `
      あなたはアニメについて詳しいです。
      コンテキストで受け取った情報を元に、アニメについて質問を答えることができます。
      これらのコンテキストは最近のWikipediaページから抽出されました。
      もしない情報がある場合はあなたの情報を使わないでください。
      レスポンスに画像は含めないでください。
      ---------------------
      ${docContext}
      ---------------------
      Questions: ${latestMessage}
    `,
  };

  const result = await streamText({
    model: openai("gpt-3.5-turbo"),
    prompt: template.content,
  });

  return result.toDataStreamResponse();
}
