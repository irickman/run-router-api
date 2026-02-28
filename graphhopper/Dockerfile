FROM israelhikingmap/graphhopper:latest

ENV GRAPH_VERSION=2

COPY config.yml /graphhopper/config.yml
COPY custom-models/ /graphhopper/custom-models/
COPY start.sh /graphhopper/start.sh
RUN chmod +x /graphhopper/start.sh

EXPOSE 8989
ENTRYPOINT ["/graphhopper/start.sh"]
