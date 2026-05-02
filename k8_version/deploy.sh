# Build API image
docker build -t replit-api:latest -f Dockerfile.api .

# Build sandbox image
docker build -t mini-replit-node:latest -f Dockerfile.sandbox .

# Load images into cluster (if using kind/minikube)
kind load docker-image replit-api:latest
kind load docker-image mini-replit-node:latest

# Or for minikube:
# minikube image load replit-api:latest
# minikube image load mini-replit-node:latest

# Apply K8s manifests
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/01-pvc.yaml
kubectl apply -f k8s/02-rbac.yaml
kubectl apply -f k8s/06-secrets.yaml
kubectl apply -f k8s/03-api-deployment.yaml
kubectl apply -f k8s/04-api-service.yaml
kubectl apply -f k8s/05-ingress.yaml

# Check deployment
kubectl get all -n replit-clone
