# Static single-page app — index.html/app.js are already final and the
# third-party libraries are vendored in vendor/, so there is no build step.
FROM nginxinc/nginx-unprivileged:1.27-alpine-slim

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js /usr/share/nginx/html/
COPY vendor/ /usr/share/nginx/html/vendor/

EXPOSE 8080
