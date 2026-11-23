"""Build the county explorer's data files.

Joins Urban Institute's Aging Opportunity Dashboard county metrics to Census
county population (Vintage 2025, July 1 2025) and land area (2025 Gazetteer).

Usage: python3 -I build_explorer_data.py <raw_data_dir> <out_dir>

Inputs (in raw_data_dir):
  02_aging-opportunity-dashboard_county.csv   Urban Institute, Nov 2026 release
  cc-est2025-agesex-all.csv                   Census county population by age
  2025_Gaz_counties_national.txt              Census Gazetteer, land area and centroid
  cenpop/CenPop2020_Mean_CO.txt               Census 2020 county centers of population
  cms/NH_ProviderInfo_Oct2026.csv             CMS nursing home Provider Information, Oct 2026
  cbp/cbp23co.txt                             Census County Business Patterns 2023, county file
  cms_ma/.../State_County_Penetration_MA_2026_11.csv   CMS Medicare Advantage penetration, Nov 2026
  usda/2023-rural-urban-continuum-codes.csv   USDA ERS Rural-Urban Continuum Codes 2023
  census_shapes/cb_2024_us_county_20m.*        Census 2024 county cartographic boundaries

Outputs (in out_dir):
  counties.json   one row per county: names, population, 50+/65+/75+/85+ and their 2020 counts, land area, density
  metrics.json    one row per county and age group, one column per metric
  metric_info.json  one row per metric: label, category, unit, year, coverage
  nursing_homes.json  one row per county: CMS nursing homes, beds, ratings, turnover, chains
  businesses.json   one row per county: senior living and home care establishments (CBP 2023)
  medicare_advantage.json  one row per county: Medicare eligibles and Medicare Advantage share
  rural_codes.json  one row per county: USDA rural-urban code, metro and remote-rural flags
  county_shapes.json  one row per county: outline as polygon coordinates
"""
import csv
import json
import os
import sys

raw, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
own_code = open(os.path.abspath(__file__), encoding="utf-8").read()

# Urban measure name -> (id, display label, unit). Labels fix two typos in the
# source file; "NA" is the one Employment and wealth metric the data dictionary
# lists that has no other name in the file ("Share employed").
METRICS = {
    "Median net worth": ("median_net_worth", "Median net worth", "usd"),
    "Median income": ("median_income", "Median income", "usd"),
    "Average income": ("avg_income", "Average income", "usd"),
    "Emergency savings": ("emergency_savings", "Emergency savings", "share"),
    "Retirement plan coverage": ("retirement_plan_coverage", "Retirement plan coverage", "share"),
    "Poverty rate": ("poverty_rate", "Poverty rate", "share"),
    "Housing cost burden": ("housing_cost_burden", "Housing cost burden", "share"),
    "Labor force participation rate": ("labor_force_participation", "Labor force participation rate", "share"),
    "NA": ("share_employed", "Share employed", "share"),
    "Unemployment rate": ("unemployment_rate", "Unemployment rate", "share"),
    "Credit card debt": ("credit_card_debt", "Credit card debt", "share"),
    "Delinquent credit card debt": ("delinquent_cc_debt", "Delinquent credit card debt", "share"),
    "Medical debt in collections": ("medical_debt_collections", "Medical debt in collections", "share"),
    "Annual wellness visit": ("annual_wellness_visit", "Annual wellness visit", "share"),
    "Welcome to Medicare preventive visit": ("welcome_to_medicare_visit", "Welcome to Medicare preventive visit", "share"),
    "Cardiovascular disease screening": ("cvd_screening", "Cardiovascular disease screening", "share"),
    "Influenza virus vaccine": ("flu_vaccine", "Influenza vaccine", "share"),
    "Pneomococcal vaccine": ("pneumococcal_vaccine", "Pneumococcal vaccine", "share"),
    "Potentially avoidable hospitalizations for chronic conditions": ("avoidable_hospitalizations", "Potentially avoidable hospitalizations (chronic conditions)", "per100k_benef"),
    "Residence in higher-quality facilities": ("ltc_higher_quality", "Residence in higher-quality facilities", "share"),
    "Residence in lower-quality facilities": ("ltc_lower_quality", "Residence in lower-quality facilities", "share"),
    "Falls with major injury": ("ltc_falls_major_injury", "Falls with major injury", "share"),
    "Pressure ulcers": ("ltc_pressure_ulcers", "Pressure ulcers", "share"),
    "Urinary tract infections": ("ltc_uti", "Urinary tract infections", "share"),
    "Antipsychotic medication": ("ltc_antipsychotic", "Antipsychotic medication", "share"),
    "Depressive symptonms": ("ltc_depressive_symptoms", "Depressive symptoms", "share"),
    "Physical restraints": ("ltc_physical_restraints", "Physical restraints", "share"),
    "Unplanned hospital stays": ("ltc_unplanned_hospital_stays", "Unplanned hospital stays", "per1000days"),
    "Outpatient emergency department visits": ("ltc_outpatient_ed_visits", "Outpatient emergency department visits", "per1000days"),
    "Mortality rate": ("mortality_rate", "Mortality rate", "per100k"),
    "Mortality rate for circulatory system diseases": ("circulatory_mortality", "Circulatory disease mortality rate", "per100k"),
    "Cancer mortality rate": ("cancer_mortality", "Cancer mortality rate", "per100k"),
    "Diabetes mortality rate": ("diabetes_mortality", "Diabetes mortality rate", "per100k"),
    "SNAP eligibility rate": ("snap_eligibility", "SNAP eligibility rate", "share"),
}
AGES = ["All", "50-64", "65+", "65-74", "75-84", "85+"]
metric_ids = [m[0] for m in METRICS.values()]

# ---- Urban metrics: sex All (or NA, used by the debt metrics), race All ----
values = {}          # (geoid, age) -> {metric_id: value}
info = {}            # metric_id -> dict
with open(os.path.join(raw, "02_aging-opportunity-dashboard_county.csv"), newline="", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        if row["race_eth"] != "All" or row["sex"] not in ("All", "NA") or row["age"] not in AGES:
            continue
        m = METRICS.get(row["measure"])
        if m is None:
            continue
        mid, label, unit = m
        rec = info.setdefault(mid, {"id": mid, "label": label, "category": row["data_category"],
                                    "unit": unit, "measure_type": row["measure_type"],
                                    "year": row["year"], "source_name": row["measure"],
                                    "counties_all_ages": 0, "ages": set()})
        if row["estimate"] == "NA":
            continue
        v = float(row["estimate"])
        v = round(v) if unit == "usd" else round(v, 4)
        values.setdefault((row["geoid"], row["age"]), {})[mid] = v
        rec["ages"].add(row["age"])
        if row["age"] == "All":
            rec["counties_all_ages"] += 1

# ---- Census population, July 1 2025 (YEAR code 7) ----
pop = {}
pop2020 = {}  # 65+, 75+ and 85+ on July 1, 2020, for growth since 2020
with open(os.path.join(raw, "cc-est2025-agesex-all.csv"), newline="", encoding="latin-1") as f:
    for row in csv.DictReader(f):
        g = row["STATE"] + row["COUNTY"]
        p75 = int(row["AGE7579_TOT"]) + int(row["AGE8084_TOT"]) + int(row["AGE85PLUS_TOT"])
        p6574 = int(row["AGE6569_TOT"]) + int(row["AGE7074_TOT"])  # Urban's age bands
        p7584 = int(row["AGE7579_TOT"]) + int(row["AGE8084_TOT"])
        if row["YEAR"] == "2":  # July 1, 2020 estimate, same vintage, for growth since 2020
            pop2020[g] = {"65": int(row["AGE65PLUS_TOT"]), "75": p75, "85": int(row["AGE85PLUS_TOT"]),
                          "65_74": p6574, "75_84": p7584}
        if row["YEAR"] != "7":
            continue
        p50 = sum(int(row[c]) for c in ["AGE5054_TOT", "AGE5559_TOT", "AGE6064_TOT", "AGE65PLUS_TOT"])
        pop[g] = {"county": row["CTYNAME"], "state_name": row["STNAME"],
                  "population": int(row["POPESTIMATE"]), "pop_50plus": p50,
                  "pop_65plus": int(row["AGE65PLUS_TOT"]), "pop_75plus": p75, "pop_85plus": int(row["AGE85PLUS_TOT"]),
                  "pop_65_74": p6574, "pop_75_84": p7584,
                  "median_age": float(row["MEDIAN_AGE_TOT"])}

# ---- Census Gazetteer: land area and internal point ----
gaz = {}
with open(os.path.join(raw, "2025_Gaz_counties_national.txt"), newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f, delimiter="|"):
        row = {k.strip(): v.strip() for k, v in row.items()}
        gaz[row["GEOID"]] = {"state": row["USPS"], "name": row["NAME"],
                             "land_sqmi": float(row["ALAND_SQMI"]),
                             "lat": float(row["INTPTLAT"]), "lon": float(row["INTPTLONG"])}

# ---- Census 2020 centers of population: where each county's residents are, on average ----
# The 30-mile totals are measured from this point, so a big county's circle starts where its people live.
# Connecticut's 2020 centers are for its former counties; its planning regions keep the Gazetteer point.
cenpop = {}
with open(os.path.join(raw, "cenpop", "CenPop2020_Mean_CO.txt"), newline="", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        cenpop[row["STATEFP"] + row["COUNTYFP"]] = (float(row["LATITUDE"]), float(row["LONGITUDE"]))

# ---- counties.json ----
geoids = sorted({g for g, _ in values} | set(pop))
counties = []
for g in geoids:
    p, z = pop.get(g), gaz.get(g)
    r = {"geoid": g, "county": None, "state": None, "state_name": None, "population": None, "pop_50plus": None,
         "pop_65plus": None, "pop_75plus": None, "pop_85plus": None,
         "pop_65plus_2020": (pop2020.get(g) or {}).get("65"), "pop_75plus_2020": (pop2020.get(g) or {}).get("75"),
         "pop_85plus_2020": (pop2020.get(g) or {}).get("85"),
         "pop_65_74": None, "pop_75_84": None,
         "pop_65_74_2020": (pop2020.get(g) or {}).get("65_74"), "pop_75_84_2020": (pop2020.get(g) or {}).get("75_84"),
         "share_65plus": None, "median_age": None,
         "land_sqmi": None, "people_per_sqmi": None, "lat": None, "lon": None,
         "reach_lat": None, "reach_lon": None, "reach_point": None,
         "census_match": bool(p and z)}
    if z:
        r.update(county=z["name"], state=z["state"], land_sqmi=round(z["land_sqmi"], 1),
                 lat=z["lat"], lon=z["lon"])
        pc = cenpop.get(g)
        r.update(reach_lat=pc[0] if pc else z["lat"], reach_lon=pc[1] if pc else z["lon"],
                 reach_point="2020 population center" if pc else "Gazetteer internal point")
    if p:
        r.update(population=p["population"], pop_50plus=p["pop_50plus"], pop_65plus=p["pop_65plus"],
                 pop_75plus=p["pop_75plus"], pop_85plus=p["pop_85plus"], median_age=p["median_age"],
                 pop_65_74=p["pop_65_74"], pop_75_84=p["pop_75_84"],
                 share_65plus=round(p["pop_65plus"] / p["population"], 4) if p["population"] else None)
        r["county"] = r["county"] or p["county"]
        r["state_name"] = p["state_name"]
    if p and z and z["land_sqmi"] > 0:
        r["people_per_sqmi"] = round(p["population"] / z["land_sqmi"], 1)
    counties.append(r)

meta_common = [
    {"label": "build_explorer_data.py", "value": own_code, "type": "code", "lang": "python"},
]
with open(os.path.join(out, "counties.json"), "w") as f:
    json.dump({"rows": counties, "meta": meta_common + [
        {"label": "Input", "value": "cc-est2025-agesex-all.csv (Census Bureau Vintage 2025 county population by age, July 1 2025, plus July 1 2020 for growth in 65+, 75+ and 85+); 2025_Gaz_counties_national.txt (Census 2025 Gazetteer, land area and internal point); CenPop2020_Mean_CO.txt (Census 2020 county centers of population, the starting point for the 30-mile totals; Connecticut's planning regions use the Gazetteer internal point)"},
    ]}, f, separators=(",", ":"))

# ---- metrics.json (compact: column list + arrays, expanded by the page's loader) ----
cols = ["geoid", "age"] + metric_ids
rows = []
for (g, a), vals in sorted(values.items()):
    rows.append([g, a] + [vals.get(m) for m in metric_ids])
with open(os.path.join(out, "metrics.json"), "w") as f:
    json.dump({"columns": cols, "rows": rows, "meta": meta_common + [
        {"label": "Input", "value": "02_aging-opportunity-dashboard_county.csv (Urban Institute, Metrics Data for the Aging Opportunity Dashboard, released Nov 10 2026). Kept rows: sex All (NA for the 2025 debt metrics), race/ethnicity All, ages All, 50-64, 65+, 65-74, 75-84, 85+."},
    ]}, f, separators=(",", ":"))

# ---- metric_info.json ----
order = {m[0]: i for i, m in enumerate(METRICS.values())}
info_rows = []
for mid in sorted(info, key=order.get):
    r = info[mid]
    r["ages"] = ", ".join(a for a in AGES if a in r["ages"])
    info_rows.append(r)
with open(os.path.join(out, "metric_info.json"), "w") as f:
    json.dump({"rows": info_rows, "meta": meta_common + [
        {"label": "Input", "value": "02_aging-opportunity-dashboard_county.csv (Urban Institute)"},
    ]}, f, separators=(",", ":"))

# ---- nursing_homes.json: CMS Provider Information, summed by county ----
# CMS gives each home's state and county name (not a FIPS code), so homes are
# matched to Gazetteer counties by state + normalized name. ALIASES covers the
# names CMS abbreviates or spells differently.
import re
import statistics
import unicodedata

ALIASES = {
    ("LA", "E. Baton Rouge"): "East Baton Rouge", ("LA", "W. Baton Rouge"): "West Baton Rouge",
    ("LA", "Jeffrson Davis"): "Jefferson Davis", ("LA", "St. John Baptist"): "St. John the Baptist",
    ("CT", "South Central Ct"): "South Central Connecticut", ("CT", "Western Ct"): "Western Connecticut",
    ("CT", "Naugatuck Vly"): "Naugatuck Valley", ("CT", "Lower Ct River Vly"): "Lower Connecticut River Valley",
    ("CT", "Southeastern Ct"): "Southeastern Connecticut", ("CT", "Nw Hills"): "Northwest Hills",
    ("CT", "Northeastern Ct"): "Northeastern Connecticut", ("DC", "The District"): "District of Columbia",
    ("PA", "Northumberlnd"): "Northumberland", ("NE", "Scott Bluff"): "Scotts Bluff",
    ("MN", "Yellow Medcine"): "Yellow Medicine", ("MN", "Lake Of  Woods"): "Lake of the Woods",
}


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("saint ", "st ").replace("st. ", "st ").replace(".", "").replace("'", "")
    s = re.sub(r"\s+(county|parish|borough|census area|city and borough|municipality|planning region)$", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


by_name = {}
for g, z in gaz.items():
    by_name.setdefault((z["state"], norm(z["name"])), []).append(g)

homes = {}            # geoid -> list of home rows
unmatched_homes = []
outside = 0           # territories the other data doesn't cover
with open(os.path.join(raw, "cms", "NH_ProviderInfo_Oct2026.csv"), newline="", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        st, name = row["State"], row["County/Parish"]
        if st in ("PR", "GU", "VI", "AS", "MP"):
            outside += 1
            continue
        name = ALIASES.get((st, name), name)
        m = by_name.get((st, norm(name))) or by_name.get((st, norm(name + " city")))
        if not m or len(m) != 1:
            unmatched_homes.append((st, row["County/Parish"]))
            continue
        homes.setdefault(m[0], []).append(row)


def num(v):
    try:
        return float(v)
    except ValueError:
        return None


nh_rows = []
for c in counties:
    if not c["census_match"]:
        continue
    hs = homes.get(c["geoid"], [])
    staffing = [num(h["Staffing Rating"]) for h in hs if num(h["Staffing Rating"]) is not None]
    overall = [num(h["Overall Rating"]) for h in hs if num(h["Overall Rating"]) is not None]
    turnover = [num(h["Total nursing staff turnover"]) for h in hs if num(h["Total nursing staff turnover"]) is not None]
    pct = lambda part, whole: round(100 * part / whole, 1) if whole else None
    nh_rows.append({
        "geoid": c["geoid"],
        "nh_count": len(hs),
        "nh_beds": int(sum(num(h["Number of Certified Beds"]) or 0 for h in hs)),
        "nh_residents": int(round(sum(num(h["Average Number of Residents per Day"]) or 0 for h in hs))),
        "nh_low_staffing_pct": pct(sum(1 for r in staffing if r <= 2), len(staffing)),
        "nh_staffing_rated": len(staffing),
        "nh_low_overall_pct": pct(sum(1 for r in overall if r <= 2), len(overall)),
        "nh_turnover_median": round(statistics.median(turnover), 1) if turnover else None,
        "nh_chain_pct": pct(sum(1 for h in hs if h["Chain Name"].strip()), len(hs)),
    })

with open(os.path.join(out, "nursing_homes.json"), "w") as f:
    json.dump({"rows": nh_rows, "meta": meta_common + [
        {"label": "Input", "value": "NH_ProviderInfo_Oct2026.csv (CMS Care Compare, Nursing Home Provider Information, October 2026; one row per Medicare/Medicaid-certified nursing home)"},
        {"label": "Matching", "value": f"Homes matched to counties by state and county name. {sum(len(v) for v in homes.values())} homes matched, {len(unmatched_homes)} unmatched, {outside} in territories left out."},
    ]}, f, separators=(",", ":"))

print("nursing homes matched", sum(len(v) for v in homes.values()), "unmatched", len(unmatched_homes), "territories", outside)
print("unmatched names:", sorted(set(unmatched_homes)))
print("certified beds total", sum(r["nh_beds"] for r in nh_rows), "counties with a home", sum(1 for r in nh_rows if r["nh_count"]))

# ---- businesses.json: Census County Business Patterns 2023 ----
# Establishments with paid employees, by county and NAICS code. Counties not
# listed for a code have no such establishment.
CBP_CODES = {"623312": "assisted_living", "623311": "ccrc", "624120": "elder_services", "621610": "home_health"}
cbp = {}
with open(os.path.join(raw, "cbp", "cbp23co.txt"), newline="", encoding="latin-1") as f:
    for row in csv.DictReader(f):
        code = CBP_CODES.get(row["naics"].strip())
        if code:
            g = row["fipstate"] + row["fipscty"]
            cbp.setdefault(g, {})[code] = int(row["est"])
census_ids = {c["geoid"] for c in counties if c["census_match"]}
biz_rows = []
for g in sorted(census_ids):
    b = cbp.get(g, {})
    al, cc, es, hh = (b.get(k, 0) for k in ("assisted_living", "ccrc", "elder_services", "home_health"))
    biz_rows.append({"geoid": g, "assisted_living": al, "ccrc": cc, "senior_living": al + cc,
                     "elder_services": es, "home_health": hh, "home_care": es + hh})
cbp_unmatched = sorted(set(cbp) - census_ids)
with open(os.path.join(out, "businesses.json"), "w") as f:
    json.dump({"rows": biz_rows, "meta": meta_common + [
        {"label": "Input", "value": "cbp23co.txt (Census Bureau County Business Patterns 2023, county file). NAICS 623312 assisted living facilities for the elderly, 623311 continuing care retirement communities, 624120 services for the elderly and persons with disabilities, 621610 home health care services."},
        {"label": "Matching", "value": f"Joined on county FIPS code. CBP counties with these businesses but no Census population row: {len(cbp_unmatched)}."},
    ]}, f, separators=(",", ":"))
print("businesses: senior living", sum(r["senior_living"] for r in biz_rows), "home care", sum(r["home_care"] for r in biz_rows),
      "| raw totals", {k: sum(v.get(k, 0) for v in cbp.values()) for k in CBP_CODES.values()}, "| CBP counties not in Census:", cbp_unmatched)

# ---- medicare_advantage.json: CMS MA State/County Penetration, November 2026 ----
ma_rows, ma_seen = [], set()
with open(os.path.join(raw, "cms_ma", "State_County_Penetration_MA_2026_11", "State_County_Penetration_MA_2026_11.csv"), newline="", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        g = row["FIPS"].strip()
        if g not in census_ids:
            continue
        elig = int(row["Eligibles"].replace(",", "") or 0)
        enrolled = row["Enrolled"].replace(",", "").strip()
        pen = row["Penetration"].replace("%", "").strip()
        ma_rows.append({"geoid": g, "medicare_eligibles": elig,
                        "ma_enrolled": int(enrolled) if enrolled.isdigit() else None,
                        "ma_pct": round(float(pen), 1) if pen else None})
        ma_seen.add(g)
with open(os.path.join(out, "medicare_advantage.json"), "w") as f:
    json.dump({"rows": ma_rows, "meta": meta_common + [
        {"label": "Input", "value": "State_County_Penetration_MA_2026_11.csv (CMS, MA State/County Penetration, November 2026). Penetration = Medicare Advantage enrollees / Medicare eligibles. CMS left out Connecticut and Alaska this month while their county codes are updated, and blanks counties with 10 or fewer enrollees."},
        {"label": "Matching", "value": f"Joined on county FIPS code: {len(ma_seen)} of {len(census_ids)} counties."},
    ]}, f, separators=(",", ":"))
missing_states = sorted({c["state"] for c in counties if c["census_match"] and c["geoid"] not in ma_seen})
print("medicare advantage counties", len(ma_seen), "of", len(census_ids), "| with a share", sum(1 for r in ma_rows if r["ma_pct"] is not None), "| states missing some:", missing_states)

# ---- rural_codes.json: USDA ERS Rural-Urban Continuum Codes 2023 ----
# Codes 1-3 are metro counties; 4-9 are nonmetro; 5, 7 and 9 are nonmetro counties
# not adjacent to a metro area ("remote rural" on the page).
rucc = {}
with open(os.path.join(raw, "usda", "2023-rural-urban-continuum-codes.csv"), newline="", encoding="latin-1") as f:
    for row in csv.DictReader(f):
        g = row["FIPS"].strip().zfill(5)
        if row["Attribute"] == "RUCC_2023" and row["Value"].strip().isdigit():
            rucc.setdefault(g, {})["code"] = int(row["Value"])
        elif row["Attribute"] == "Description":
            rucc.setdefault(g, {})["desc"] = row["Value"].strip()
rural_rows = []
for g in sorted(census_ids):
    r = rucc.get(g, {})
    code = r.get("code")
    rural_rows.append({"geoid": g, "rucc": code, "rucc_desc": r.get("desc"),
                       "metro": None if code is None else code <= 3,
                       "remote": None if code is None else code in (5, 7, 9)})
with open(os.path.join(out, "rural_codes.json"), "w") as f:
    json.dump({"rows": rural_rows, "meta": meta_common + [
        {"label": "Input", "value": "2023-rural-urban-continuum-codes.csv (USDA Economic Research Service, Rural-Urban Continuum Codes 2023). Codes 1-3 metro; 4-9 nonmetro; 5, 7, 9 nonmetro and not adjacent to a metro area."},
        {"label": "Matching", "value": f"Joined on county FIPS code: {sum(1 for r in rural_rows if r['rucc'] is not None)} of {len(census_ids)} counties have a code."},
    ]}, f, separators=(",", ":"))
print("rural codes: matched", sum(1 for r in rural_rows if r["rucc"] is not None), "of", len(census_ids),
      "| metro", sum(1 for r in rural_rows if r["metro"]), "| nonmetro", sum(1 for r in rural_rows if r["metro"] is False),
      "| remote", sum(1 for r in rural_rows if r["remote"]),
      "| missing", [r["geoid"] for r in rural_rows if r["rucc"] is None][:20])

# ---- county_shapes.json: Census 2024 cartographic boundaries (1:20,000,000) ----
# A small shapefile reader: polygons (type 5) from the .shp, GEOIDs from the .dbf.
# Rings are grouped into polygons by winding: clockwise rings are outer edges and
# counterclockwise rings are holes, which is also the order d3 expects.
import struct


def read_dbf_geoids(path):
    with open(path, "rb") as fh:
        hdr = fh.read(32)
        nrec, hlen, rlen = struct.unpack("<IHH", hdr[4:12])
        fields = []
        while True:
            d = fh.read(32)
            if d[0] == 0x0D:
                break
            fields.append((d[:11].split(b"\x00")[0].decode(), d[16]))
        fh.seek(hlen)
        out_ids = []
        for _ in range(nrec):
            rec = fh.read(rlen)
            pos, row = 1, {}
            for name, ln in fields:
                row[name] = rec[pos:pos + ln].decode("latin-1").strip()
                pos += ln
            out_ids.append(row["GEOID"])
        return out_ids


def ring_area(ring):
    return sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1)) / 2


def inside(pt, ring):
    x, y, hit = pt[0], pt[1], False
    for i in range(len(ring) - 1):
        (x1, y1), (x2, y2) = ring[i], ring[i + 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def read_shapes(path):
    with open(path, "rb") as fh:
        data = fh.read()
    shapes, i = [], 100
    while i < len(data):
        clen = struct.unpack(">i", data[i + 4:i + 8])[0] * 2
        rec = data[i + 8:i + 8 + clen]
        i += 8 + clen
        if struct.unpack("<i", rec[:4])[0] != 5:
            shapes.append([])
            continue
        nparts, npts = struct.unpack("<ii", rec[36:44])
        parts = list(struct.unpack("<%di" % nparts, rec[44:44 + 4 * nparts])) + [npts]
        pts = struct.unpack("<%dd" % (2 * npts), rec[44 + 4 * nparts:44 + 4 * nparts + 16 * npts])
        rings = []
        for a, b in zip(parts[:-1], parts[1:]):
            ring = []
            for k in range(a, b):
                q = [round(pts[2 * k], 3), round(pts[2 * k + 1], 3)]
                if not ring or ring[-1] != q:
                    ring.append(q)
            if len(ring) >= 4:
                rings.append(ring)
        shapes.append(rings)
    return shapes


shp_base = os.path.join(raw, "census_shapes", "cb_2024_us_county_20m")
shape_rows, shape_pts = [], 0
for g, rings in zip(read_dbf_geoids(shp_base + ".dbf"), read_shapes(shp_base + ".shp")):
    if g not in census_ids:
        continue
    outers = [r for r in rings if ring_area(r) < 0]
    holes = [r for r in rings if ring_area(r) >= 0]
    polys = [[r] for r in outers]
    for h in holes:
        home = next((p for p in polys if inside(h[0], p[0])), polys[-1] if polys else None)
        if home is not None:
            home.append(h)
    shape_pts += sum(len(r) for r in rings)
    shape_rows.append({"geoid": g, "coords": polys})
with open(os.path.join(out, "county_shapes.json"), "w") as f:
    json.dump({"rows": shape_rows, "meta": meta_common + [
        {"label": "Input", "value": "cb_2024_us_county_20m (Census Bureau 2024 cartographic boundary file, counties, 1:20,000,000). Coordinates rounded to 0.001 degree; Puerto Rico left out."},
    ]}, f, separators=(",", ":"))
print("county shapes:", len(shape_rows), "of", len(census_ids), "| points", shape_pts,
      "| counties with holes", sum(1 for r in shape_rows if any(len(p) > 1 for p in r["coords"])),
      "| multi-part", sum(1 for r in shape_rows if len(r["coords"]) > 1),
      "| with no outer ring", [r["geoid"] for r in shape_rows if not r["coords"]])

print("counties", len(counties), "matched", sum(c["census_match"] for c in counties))
print("metric rows", len(rows), "metrics", len(info_rows))
for r in info_rows:
    print(f'{r["id"]:32s} {r["category"]:22s} {r["year"]:10s} n={r["counties_all_ages"]:5d} ages={r["ages"]}')
unmatched = [c["geoid"] for c in counties if not c["census_match"]]
print("no census match:", unmatched)
for g in unmatched:
    print(g, sorted(k for (gg, a), v in values.items() if gg == g for k in v)[:40])
