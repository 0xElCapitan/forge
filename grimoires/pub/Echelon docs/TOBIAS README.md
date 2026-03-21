# External Theatre Repo Specs

This folder contains the current `construct.yaml` and `construct.json` copies used for the three external theatre repos:

- `tremor_construct.yaml`
- `tremor_construct.json`
- `corona_construct.yaml`
- `corona_construct.json`
- `breath_construct.yaml`
- `breath_construct.json`

## Source of truth

- `TREMOR` and `CORONA` are copied from the current local repo versions that passed the Echelon full-stack validation path.
- `BREATH` is copied from the patched local version prepared to make the repo Echelon-compatible in the same style as TREMOR/CORONA.

## BREATH note

`BREATH` is materially improved in this bundle:

- now has a `construct.yaml`
- now declares `construct_class: theatre`
- now exposes calibration metadata
- now exposes cross-validation metadata in a way Echelon can plan
  - `SETTLEMENT_ACCURACY`
  - `ORACLE_CONSISTENCY`
  - `CALIBRATION_VALIDITY`
  - `FUNCTIONAL_CORRECTNESS`

One remaining caveat is on the Echelon side:

- `breath_construct.yaml` currently uses `environmental` as a domain claim
- current Echelon policy normalization treats that as vague / unrecognized
- this means BREATH can still receive `tier_cap = UNVERIFIED` until Echelon adds a more precise air-quality domain such as `air_quality_intelligence`

So the files here are suitable for review and improvement, but BREATH still benefits from either:

1. an Echelon precise-domain addition for air quality
2. or a revised BREATH domain claim aligned to whatever precise air-quality label Echelon adopts
