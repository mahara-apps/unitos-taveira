# Corrigir a tela do cliente que quebra com aba desconhecida

A ficha do cliente está mostrando "Erro ao carregar a página" quando o endereço traz uma aba que ela não conhece (no seu caso, `pedidos`). Hoje qualquer valor fora da lista derruba a página inteira, em vez de simplesmente abrir a visão geral.

## O que verifiquei

- A ficha do cliente aceita apenas uma lista fixa de abas: `overview`, `conta`, `briefing`, `pauta`, `trabalho`, `publicacoes`, `area-cliente`, mais os apelidos antigos `cadastro`, `gestao`, `estrategia`, `producao`, `channels`.
- O valor `pedidos` não está nessa lista e não é gerado por nenhum link do código atual — ele chega de um endereço salvo/compartilhado (favorito, aviso antigo ou link do portal).
- A validação do endereço lança erro em vez de cair num padrão, e é isso que produz a tela de erro com o texto técnico da imagem.
- A mensagem da imagem não lista a aba "Área do cliente", o que indica que a aba aberta estava com uma versão anterior carregada; recarregar resolve esse detalhe, mas não a quebra.

## O que vamos fazer

1. Tornar a leitura do endereço tolerante: aba desconhecida passa a abrir a aba correspondente mais próxima, e na dúvida a "Visão geral" — nunca mais tela de erro.
2. Mapear `pedidos` (e `requests`) para a aba "Área do cliente", que é onde os pedidos do cliente aparecem hoje. Assim links antigos param no lugar certo.
3. Manter a correção de endereço na barra do navegador, para o link continuar válido depois.
4. Fazer o mesmo tratamento tolerante nos outros parâmetros do endereço da ficha (por exemplo um identificador de pauta inválido não deve derrubar a página).

## Detalhes técnicos

- `src/lib/customer-tabs.ts`: adicionar `pedidos` e `requests` a `CUSTOMER_TAB_ALIASES` apontando para `area-cliente`; `resolveCustomerTab` já cobre o resto.
- `src/routes/_authenticated/customers.$customerId.tsx`: trocar o `z.enum(...).parse` por um schema tolerante (`z.string().optional().catch(undefined)` + `.catch({})` no objeto) e normalizar com `resolveCustomerTab` no `beforeLoad`, mantendo o `redirect` que já reescreve a busca.
- Teste em `tests/customer-tabs.test.ts`: `pedidos`/`requests` resolvem para `area-cliente` e um valor aleatório resolve para `overview`.
- Sem mudança de banco, RLS ou release; nada a propagar para instalações derivadas além do código.
