-- run_config is now auto-detected from the repo (pom.xml → Maven, package.json → npm)
alter table cm_repo drop column if exists run_config;
