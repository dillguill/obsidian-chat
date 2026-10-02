## Scope

Portfolio project meant for occasional showcase and demonstration. Demonstrating LLM ability for grounded document maintenance and adjustment. 

Ideally free with accepted caveats of rate limited services 

## Core Features

### Phase 1

Basic chat interface (base on openwebui) with document upload and basic model context parsing documents into live updated markdown wiki in documents section. (Each section is grouped in a grid style based on domain/ingest type)

### Phase 2

RAG addition to break original documents into vector stores that can be dynamically managed in rag interface / knowledge base (similar to open webui knowledge with added layer of live rag tweaking or visual)

### Phase 3

Comparison of the live docs/wiki for accuracy from source material by comparison

## Frontend

- gh-pages
- Vite + react + shadcdn/ui
- assistant-ui (Main interface / sidebar; largely inspired by open webui)
	- Chat interface
		- Capable of a/b testing models 
		- Option to choose source of knowledge 
		- Able to view as full screen (open webui) or sidebar (vs code)
	- Analytics
		- Usage dashboard with in-depth model selection
	- Documents (wiki)
		- Artifacts written in markdown displayed as editable documents (similar to obsidian/notion) with embeds (svg, images, links)
	- Rag interface + knowledge base/ upload
	- Skills
	- System prompt
	- Pipelines
- mobile responsive
- Enterprise UI (navy + white)

## Backend

- OpenRouter (model testing + low cost/free api)
- RAG (considering)
	- Need to know what is low cost/free
	- Swappable vector stores
- Document hosting
	- Need place to host uploaded docs
	- Docs are stored and referenced by artifacts
  
## Decisions 

- [ ] RAG framework 
- [ ] Document host