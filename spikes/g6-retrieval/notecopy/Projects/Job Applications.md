---
type: project
tags: [projects]
status: active
---
## Content

### Q&A

```base
filters:
  and:
    - file.tags.contains("jobs")
views:
  - type: table
    name: Q&A
    filters:
      and:
        - file.tags.containsAll("q-a")
```

### Jobs

```base
views:
  - type: table
    name: Table
    filters:
      and:
        - file.tags.containsAny("jobs")

```
