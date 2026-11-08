# TraceMark Worker

Processamento assíncrono do **TraceMark**: aplica a marca-d'água nas fotos enviadas pelos fotógrafos. Projeto acadêmico de Computação em Nuvem (UFC).

Este repositório tem dois programas:

| Programa | Roda em | Função |
|---|---|---|
| **Lambda `validate-upload`** | AWS Lambda | Disparada pelo S3 quando uma original chega; valida a chave e publica uma mensagem no SQS |
| **Worker** | Container no ECS (EC2) | Consome o SQS, gera a prévia com marca-d'água, salva no S3 e avisa a API |

**Stack:** Node.js 24 · TypeScript · sharp · AWS SDK v3 (S3, SQS) · Zod · pino · Vitest

## Fluxo

```
S3 ObjectCreated photos/{id}/original.jpg
  → Lambda → SQS
      → Worker: PATCH PROCESSING → baixa a original → marca-d'água → salva photos/{id}/watermarked.jpg
                → PATCH PUBLISHABLE → remove a mensagem da fila
```

- A prévia sai em JPEG, com no máximo 1600px no maior lado e sem metadados EXIF/GPS.
- Falha temporária (rede, API fora): a mensagem volta para a fila. Na última tentativa, a foto é marcada como `ERROR`.
- Falha definitiva (arquivo corrompido, formato inválido, original ausente): a foto é marcada como `ERROR` na hora.
- Tudo é idempotente: reprocessar a mesma mensagem não duplica nada.

## Como rodar localmente

Pré-requisitos: Node.js ≥ 22, Docker e o [tracemark-api](../tracemark-api) rodando com o emulador S3 (`docker compose --profile storage up -d`).

```bash
npm install
cp .env.example .env     # copie INTERNAL_API_TOKEN e as chaves AWS_* do .env da API
docker compose up -d     # SQS local (ElasticMQ), com fila e DLQ já criadas
npm run dev              # inicia o Worker
npm run smoke            # fluxo completo: upload → Lambda → Worker → foto publicada
```

| Script | Função |
|---|---|
| `npm test` | Testes unitários + integração (ElasticMQ e S3 local reais) |
| `npm run typecheck` | Checagem de tipos |
| `npm run lambda:build` | Gera `dist/lambda/validate-upload.zip` (handler `index.handler`) |
| `npm run lambda:simulate -- photos/<id>/original.jpg` | Executa a Lambda com um evento S3 simulado |
| `npm run build` / `npm start` | Build e execução do Worker |

## Organização

| Pasta | Responsabilidade |
|---|---|
| `src/domain/` | Formato das chaves do S3, contrato da mensagem e erros |
| `src/application/` | Casos de uso (`ProcessPhotoUseCase`, `EnqueueUploadedPhotosUseCase`) e contratos (ports) |
| `src/infrastructure/` | S3, SQS, sharp, cliente da API, logger e health |
| `src/lambda/` | Handler da Lambda |
| `src/worker.ts` | Ponto de entrada do container |

## Variáveis de ambiente

Veja [.env.example](.env.example). Principais:

| Variável | Descrição |
|---|---|
| `SQS_QUEUE_URL` | Fila de processamento (Lambda e Worker) |
| `S3_BUCKET` | Bucket das fotos |
| `API_BASE_URL` | URL interna da API |
| `INTERNAL_API_TOKEN` 🔒 | Mesmo valor configurado na API |
| `WORKER_CONCURRENCY` | Mensagens processadas em paralelo (padrão 2) |
| `MAX_RECEIVE_COUNT` | Tentativas antes de marcar `ERROR`; deve ser igual ao `maxReceiveCount` da DLQ (padrão 3) |
| `SQS_ENDPOINT`, `S3_ENDPOINT` | Apenas para os emuladores locais |

🔒 Em produção, vem do **AWS Secrets Manager**. As credenciais AWS vêm das IAM Roles, nunca do `.env`.

## Deploy na AWS

**Fila:** SQS `tracemark-photo-processing` com DLQ (`maxReceiveCount` 3) e *visibility timeout* de 60s.

**Lambda:**
- Runtime Node.js 22 ou superior; envie o `validate-upload.zip` e configure a variável `SQS_QUEUE_URL`.
- Role com `sqs:SendMessage` na fila, além dos logs.
- Evento do S3 `ObjectCreated` com prefixo `photos/` e **um filtro de sufixo para cada extensão** (`original.jpg`, `original.png`, `original.webp`). Esses filtros evitam que salvar a `watermarked.jpg` dispare a Lambda de novo.

**Worker (ECS no EC2):**
- Imagem: `docker build -t tracemark-worker .`
- Task role com:
  - `sqs:ReceiveMessage`, `sqs:DeleteMessage` e `sqs:GetQueueAttributes`;
  - `s3:GetObject` em `photos/*/original.*`;
  - `s3:PutObject` em `photos/*/watermarked.*`;
  - leitura do segredo.
- Health em `:8080/health` e logs via `awslogs` no CloudWatch.
- O Security Group da API deve liberar a porta dela para o Worker.
