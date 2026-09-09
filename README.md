# Apresentação — Manutenção do PISF (CMT Engenharia)

Site estático, em formato de slides, das atividades de operação e manutenção de subestações (SE), linhas de transmissão (LT) e de distribuição (LD) dos Eixos Norte e Leste do Projeto de Integração do Rio São Francisco (PISF). Reúne registros fotográficos de campo, segurança do trabalho, eventos, óbices e cronogramas, organizados por área e tópico, além de um glossário técnico, um histórico de modificações e snapshots históricos.

## Como executar

Não há build. As páginas usam `fetch` e caminhos relativos, portanto **precisam ser servidas por HTTP** — via `file://` a navegação lateral, os banners e o histórico não carregam.

- **Duplo clique em `abrir-apresentação.bat`** (Windows) — sobe um servidor local embutido (sem admin, só `localhost`) e abre o navegador em `http://localhost:8123/`. Mantenha a janela do console aberta durante a apresentação; feche-a para encerrar. É a forma recomendada ao distribuir a pasta para outros computadores.
- Alternativa manual, a partir da raiz `presentation/`:

  ```powershell
  python -m http.server 8000
  start http://localhost:8000/apresentação.html
  ```

## Publicação

A versão online é servida pelo **GitHub Pages** a partir do branch `main`: <https://eng-dvco.github.io/presentation/apresentação.html>. Todo push publica; ao fim de cada deploy, o workflow **Post-deploy QA** (`.github/workflows/post-deploy-qa.yml`) confere se toda referência de HTML/CSS/histórico resolve no site publicado e, no repositório, se cada imagem de slide tem ao menos uma variante WebP. A página **Histórico de Modificações** (`slides/history.html`) é reconstruída a partir do log do git (`history/history-indefinida.json`) e deve ser regenerada e commitada antes de cada publicação.

## Estrutura

```text
presentation/
├── apresentação.html         # porta de entrada (landing)
├── abrir-apresentação.bat    # execução local (servidor embutido + navegador)
├── slides/                   # index.html (grade de conteúdo) + slide-*.html
├── styles/                   # CSS — tokens em variables.css (carregado primeiro)
├── scripts/                  # JS — navegação, lightbox, cronogramas, histórico
├── assets/                   # imagens, ícones, logos, fontes e mídias
├── history/                  # dados e miniaturas do Histórico de Modificações
├── public/                   # definitions/ (glossário) e snapshots/ (cópias congeladas, imutáveis)
└── ci/                       # verificações pós-deploy executadas pelo GitHub Actions
```

Alguns apoios existem apenas em disco e **não são versionados**: `tools/` (otimização de imagens, geração do histórico e verificações), `.documents/` (arquivo-fonte dos documentos listados em "documentos recebidos"), os moldes `*-template.*`, os manifestos `descrição*.txt` e `assets/media/`.

## Princípios

- **Edição direta** — sem build; toda alteração é feita na raiz e publicada por push no `main`.
- **Navegação automática** — a barra lateral é derivada de `slides/index.html` por `scripts/slide-nav.js`; para incluir, remover ou recategorizar um slide, edite a grade em `index.html`.
- **Manifesto de imagens** — cada diretório de imagens de slide carrega um `descrição.txt` que descreve subseções, legendas e diretivas de layout das fotos.
- **Snapshots imutáveis** — nunca edite `public/snapshots/`; são cópias históricas congeladas.

## Autoria

Material da **CMT Engenharia** — PISF, Contrato 26/2022-MDR. Autoria do Eng. Daniel Carvalho.
Repositório: `github.com/eng-dvco/presentation`.
