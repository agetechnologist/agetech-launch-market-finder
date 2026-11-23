# AgeTech Launch Market Finder

Where should you build your next AgeTech company? Answer a few questions and see how every US county scores as a launch market, from 0 to 100.

Data: Urban Institute, Metrics Data for the AARP-Urban Institute Aging Opportunity Dashboard (ODC-BY 1.0); U.S. Census Bureau population estimates, Gazetteer, centers of population, County Business Patterns and county boundaries; CMS Medicare Advantage and nursing home files; USDA ERS Rural-Urban Continuum Codes. Data as of November 2026.

## Files

- `index.html`, `config.js`, `calcs.js`, `views.js` and `dash-runtime.js` are the page. Edit them directly; there is no separate build step for the page.
- `data/` holds the files the page loads.
- `tools/build_explorer_data.py` rebuilds everything in `data/` from the raw Census, CMS, USDA and Urban Institute files listed at the top of the script. Each data file also carries a copy of this script in its metadata.

## Security policy

`index.html` starts with a Content-Security-Policy tag. The browser runs scripts only from this site and the pinned d3 file on cdnjs, and blocks inline scripts. If you add anything that loads from another site (analytics, an embed, other fonts, a newer d3), add its address to that tag, or the browser will block it. Blocked items show up in the browser console as lines starting with "Refused to".
