# Corrigir atualização e versionamento da Casa 8

## Diagnóstico confirmado
- O mesmo commit da Casa 8 gerou dois deployments de produção: um ficou `BLOCKED` por ter sido criado pela API, enquanto o deployment disparado pelo Git concluiu como `READY`.
- A busca atual para no primeiro deployment com o mesmo commit. Ela escolheu o registro `BLOCKED`, ignorou o `READY` e encerrou a atualização antes de registrar a versão.

## Implementação
1. Ajustar a seleção de deployments para considerar todos os resultados do commit e priorizar `READY`; depois builds ainda ativos; deixar `BLOCKED`, `ERROR` e `CANCELED` por último.
2. Preservar a consulta detalhada do deployment escolhido e incluir o motivo real da hospedagem quando houver falha terminal.
3. Adicionar testes para o caso real: mesmo commit com um deployment de API bloqueado e outro deployment Git pronto, independentemente da ordem retornada.
4. Reconciliar a execução da Casa 8 com o deployment `READY` já comprovado, executar a validação final e registrar a versão efetivamente publicada sem alterar dados operacionais.
5. Aplicar o fluxo MASTER-first: regenerar o delta, sincronizar a versão do pacote e executar `bun run master:check`.

## Validação
- Testes direcionados do fluxo de atualização e retomada.
- Typecheck e build.
- Conferência no banco de que a Casa 8 ficou sem operação ativa, com versão registrada e status coerente.
