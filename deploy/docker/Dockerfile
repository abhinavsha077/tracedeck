FROM node:22-alpine
WORKDIR /opt/tracedeck
COPY . .
ENV NODE_ENV=production TRACEDECK_HOST=0.0.0.0 TRACEDECK_PORT=4177 TRACEDECK_DATA_DIR=/var/lib/tracedeck
RUN mkdir -p /var/lib/tracedeck && chown -R node:node /var/lib/tracedeck /opt/tracedeck
USER node
EXPOSE 4177
VOLUME ["/var/lib/tracedeck"]
CMD ["node", "apps/server/server.mjs"]
