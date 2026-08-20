# Analytics QuartaVia V2

Portal simplificado de inteligência executiva da QuartaVia.

## Stack

- HTML, CSS e JavaScript vanilla
- Node.js apenas para APIs serverless
- Deploy exclusivo na Vercel

## Execução local

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

O comando `npm run dev` sobe um servidor estático local que também atende `GET /api/auth-config`, lendo `AUTH_SUPABASE_URL` e `AUTH_SUPABASE_ANON_KEY` de `.env.local` ou `.env`.

Sem essas variáveis, a tela de login aparece com a mensagem de configuração ausente. Copie `.env.example` para `.env.local` e preencha as chaves.

`npm run dev:static` usa apenas `serve` e **não** executa funções da Vercel. O login precisa de `/api/auth-config`.

No deploy, as Serverless Functions em `/api` são executadas pela Vercel. Inclua o origin do app (e `http://localhost:3000/**` para desenvolvimento) na allowlist de Redirect URLs do Supabase Auth.

## Autenticação

- Projeto Auth separado da BASE QV
- Google OAuth, PKCE
- Domínio permitido: `quartavia.com.br` (exato após o `@`)

Variáveis:

```text
AUTH_SUPABASE_URL=
AUTH_SUPABASE_ANON_KEY=
```

## Deploy

Publicar na Vercel. APIs futuras devem ficar em `/api`.
