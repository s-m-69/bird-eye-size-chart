FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000

COPY package.json package-lock.json ./

RUN npm ci --include=dev && npm cache clean --force

COPY . .

RUN npx prisma generate && npm run build

EXPOSE 10000

CMD ["npm", "run", "docker-start"]
