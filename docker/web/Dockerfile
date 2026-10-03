# Packt den fertigen Client-Build (dist/ aus "make compile") in nginx; hier wird nichts kompiliert.
FROM nginx:1.31.6-alpine

# Vorlage: das Image ersetzt Umgebungsvariablen beim Start und schreibt /etc/nginx/conf.d/default.conf
COPY docker/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY dist/ /usr/share/nginx/html/
