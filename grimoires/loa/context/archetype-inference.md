# Archetype Inference
- **Archetype**: data-pipeline-ml
- **Confidence**: high
- **Rationale**: FORGE is a multi-source data ingestion + statistical classification + rule-based selection pipeline with convergence-driven iterative improvement. It maps cleanly onto ML pipeline archetypes: normalize → featurize → classify → select → evaluate → iterate. The convergence loop (keep/discard based on scoring) is a direct analog of an eval-driven ML training loop.
