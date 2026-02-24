---
title: "Oligool: Project Features & Workflow"
author: "Mgr. Vojtěch Rejtar"
date: "2026-02-24"
---

# Oligool: Project Overview

**Author:** Mgr. Vojtěch Rejtar
**Date:** February 24, 2026
**Project:** Oligool

Oligool is a native desktop application designed to streamline the design, alignment, and analysis of genetic sequences and custom oligos for molecular biologists.

---

## Features and Capabilities

1. **Dual-Source Search & Fetch**
   - Seamless toggling between NCBI and Ensembl data sources for finding genes and transcripts.
   - Smart filtering with persistent search parameters (E-value, Identity %, Organism) that survive application restarts.

2. **Interactive MSA Viewer**
   - High-performance Multiple Sequence Alignment powered by MAFFT.
   - 2D Navigation via an interactive minimap for scrubbing through massive alignments, highlighting conservation patterns, and identifying variations.

3. **"Oligize!" Design**
   - Precision splitting of genomic regions into two contiguous oligos with exact control over shift and lengths.
   - Live integration with IDT OligoAnalyzer to evaluate hairpin formation and self-dimerization in real time (Delta G).

4. **"Primerize!" Schematic**
   - High-fidelity SVG visual assembly of your molecular design, accurately representing Forward and Reverse Primer Binding Sites (PBS) and TAG sequences.
   - **Seq Mode:** Toggle to a high-detail view displaying base-by-base lettering along the schematics architecture.
   - **Persistence:** Local storage of user TAGs, PBS sequences, and design preferences.

---

## Typical Workflow

1. **Launch the Application**
   - **macOS:** Run the standalone Mac bundle `Oligool.app`.
   - **Windows:** Execute the single-file executable `Oligool.exe`.
   - All credentials (e.g., NCBI Key, IDT API authentication) and design configurations are securely stored locally via `localStorage`.

2. **Search and Retrieve Sequences**
   - Toggle between NCBI and Ensembl.
   - Enter your target gene name or accession ID to retrieve annotated sequence data.

3. **Sequence Alignment (Optional)**
   - Upload multiple sequences and utilize the MAFFT-powered MSA Viewer to align them.
   - Use the 2D minimap to identify conserved regions.

4. **Oligo Design ("Oligize!")**
   - Select a genomic region of interest.
   - Define your desired shift and oligo lengths to split the region into two contiguous oligos.
   - Review the live IDT OligoAnalyzer real-time Delta G values to avoid hairpins and self-dimerization.

5. **Visual Assembly ("Primerize!")**
   - Navigate to the schematic view to visually assemble your molecular design.
   - Input your custom TAGs, Forward PBS, and Reverse PBS.
   - Enable **Seq Mode** to verify the base-by-base construct architecture.
   - Use the generated sequence constructs for your downstream experimental workflows.
