ARG NODE_VERSION=20.18.1
ARG RUST_VERSION=1.91.0
ARG SOROBAN_CLI_VERSION=23.0.0

FROM mcr.microsoft.com/devcontainers/javascript-node:20

ARG NODE_VERSION
ARG RUST_VERSION
ARG SOROBAN_CLI_VERSION

USER root

# Pin Node even if the base image drifts.
RUN su node -c "source /usr/local/share/nvm/nvm.sh && nvm install ${NODE_VERSION} && nvm alias default ${NODE_VERSION}"

# Shared Rust install so root, node, and vscode all see the same toolchain.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:${PATH}
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain ${RUST_VERSION} \
    && rustup target add wasm32-unknown-unknown --toolchain ${RUST_VERSION} \
    && chmod -R a+w "${RUSTUP_HOME}" "${CARGO_HOME}"

# Soroban / Stellar CLI
RUN cargo install --locked --version ${SOROBAN_CLI_VERSION} soroban-cli \
    || cargo install --locked --version ${SOROBAN_CLI_VERSION} stellar-cli

# Supabase CLI
RUN npm install -g supabase

USER node
ENV PATH="/usr/local/cargo/bin:${PATH}"
