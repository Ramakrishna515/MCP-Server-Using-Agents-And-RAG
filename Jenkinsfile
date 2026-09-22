pipeline {
    agent none

    options {
        timestamps()
        ansiColor('xterm')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    environment {
        NODE_ENV = 'test'

        IMAGE = 'build-mcp-server'
        IMAGE_TAG = 'latest'

        CONTAINER = 'build-mcp-server'

        // Host port -> Container port
        HOST_PORT = '3000'
        CONTAINER_PORT = '4001'
    }

    stages {

        stage('Build & Test') {

            agent {
                docker {
                    image 'node:22'
                }
            }

            stages {

                stage('Checkout') {
                    steps {
                        checkout scm

                        sh '''
                            echo "=========================================="
                            echo "CHECKOUT INFORMATION"
                            echo "=========================================="

                            echo "Branch:"
                            git branch --show-current

                            echo "Commit:"
                            git rev-parse --short HEAD

                            echo "Commit message:"
                            git log -1 --pretty=%s

                            echo "Remote:"
                            git remote get-url origin || true

                            echo "=========================================="
                        '''
                    }
                }

                stage('Environment') {
                    steps {
                        sh '''
                            echo "=========================================="
                            echo "ENVIRONMENT"
                            echo "=========================================="

                            echo "NODE_ENV      : ${NODE_ENV}"
                            echo "Node          : $(node --version)"
                            echo "NPM           : $(npm --version)"

                            echo "=========================================="
                        '''
                    }
                }

                stage('Install dependencies') {
                    steps {
                        sh 'npm ci'
                    }
                }

                stage('Build') {
                    steps {
                        sh 'npm run build'
                    }
                }

                stage('Test') {
                    steps {
                        sh 'npm run test'
                    }
                }

                stage('Server Smoke Test') {
                    steps {
                        sh '''
                            set +e

                            node dist/server.js > server.log 2>&1 &
                            SRV=$!

                            sleep 2

                            if grep -q "running on stdio" server.log; then

                                echo "PASS: server started and is listening on stdio"

                                kill $SRV 2>/dev/null
                                wait $SRV 2>/dev/null

                                exit 0

                            else

                                echo "FAIL: server did not start"
                                cat server.log

                                kill $SRV 2>/dev/null
                                wait $SRV 2>/dev/null

                                exit 1
                            fi
                        '''
                    }
                }

                stage('Web Smoke Test') {
                    steps {
                        sh '''
                            set +e

                            PORT=${CONTAINER_PORT} \
                            node dist/http.js > web.log 2>&1 &

                            WEB=$!
                            OK=0

                            echo "Testing application on port ${CONTAINER_PORT}"

                            for i in $(seq 1 15); do

                                if curl -s -o /dev/null \
                                    -w "%{http_code}" \
                                    http://localhost:${CONTAINER_PORT}/ \
                                    2>/dev/null | grep -q 200; then

                                    echo "PASS: web portal responding on :${CONTAINER_PORT}"

                                    OK=1
                                    break
                                fi

                                sleep 1
                            done

                            if [ $OK = 0 ]; then

                                echo "FAIL: web portal did not respond"

                                cat web.log

                                kill $WEB 2>/dev/null
                                wait $WEB 2>/dev/null

                                exit 1
                            fi

                            kill $WEB 2>/dev/null
                            wait $WEB 2>/dev/null

                            exit 0
                        '''
                    }
                }
            }
        }

        stage('Docker Image') {

            agent any

            steps {
                sh '''
                    set -e

                    echo "=========================================="
                    echo "DOCKER IMAGE"
                    echo "=========================================="

                    echo "Image      : ${IMAGE}"
                    echo "Tag        : ${IMAGE_TAG}"
                    echo "Full Image : ${IMAGE}:${IMAGE_TAG}"

                    docker build \
                        -t ${IMAGE}:${IMAGE_TAG} \
                        .

                    echo ""
                    echo "Docker image created:"
                    docker images | grep ${IMAGE}

                    echo "=========================================="
                '''
            }
        }

        stage('Deploy Container') {

            agent any

            steps {
                sh '''
                    set -e

                    echo "=========================================="
                    echo "DOCKER CONTAINER DEPLOYMENT"
                    echo "=========================================="

                    echo "Container Name : ${CONTAINER}"
                    echo "Docker Image   : ${IMAGE}:${IMAGE_TAG}"
                    echo "Host Port      : ${HOST_PORT}"
                    echo "Container Port : ${CONTAINER_PORT}"
                    echo "Port Mapping   : ${HOST_PORT}:${CONTAINER_PORT}"
                    echo "Environment    : ${NODE_ENV}"

                    echo ""
                    echo "Stopping existing container..."

                    docker stop ${CONTAINER} 2>/dev/null || true

                    echo "Removing existing container..."

                    docker rm ${CONTAINER} 2>/dev/null || true

                    echo ""
                    echo "Starting new container..."

                    docker run -d \
                        --name ${CONTAINER} \
                        --restart unless-stopped \
                        -p ${HOST_PORT}:${CONTAINER_PORT} \
                        -e NODE_ENV=${NODE_ENV} \
                        ${IMAGE}:${IMAGE_TAG}

                    echo ""
                    echo "=========================================="
                    echo "CONTAINER STATUS"
                    echo "=========================================="

                    docker ps \
                        --filter "name=${CONTAINER}" \
                        --format "table {{.Names}}\\t{{.Image}}\\t{{.Ports}}\\t{{.Status}}"

                    echo ""
                    echo "=========================================="
                    echo "PORT INFORMATION"
                    echo "=========================================="

                    docker port ${CONTAINER}

                    echo ""
                    echo "Application URL:"
                    echo "http://localhost:${HOST_PORT}"

                    echo "=========================================="
                '''
            }
        }

        stage('Health Check') {

            agent any

            steps {
                sh '''
                    set -e

                    echo "=========================================="
                    echo "HEALTH CHECK"
                    echo "=========================================="

                    sleep 5

                    echo "Checking:"
                    echo "http://localhost:${HOST_PORT}/"

                    HTTP_STATUS=$(curl \
                        -s \
                        -o /dev/null \
                        -w "%{http_code}" \
                        http://localhost:${HOST_PORT}/)

                    echo "HTTP Status: ${HTTP_STATUS}"

                    if [ "${HTTP_STATUS}" = "200" ]; then
                        echo "PASS: Application is running"
                    else
                        echo "FAIL: Application returned HTTP ${HTTP_STATUS}"

                        echo ""
                        echo "Container logs:"
                        docker logs ${CONTAINER} --tail 50

                        exit 1
                    fi

                    echo "=========================================="
                '''
            }
        }
    }

    post {

        success {
            echo '''
==========================================
DEPLOYMENT SUCCESSFUL
==========================================
'''
        }

        failure {
            echo '''
==========================================
DEPLOYMENT FAILED
==========================================
'''
        }

        always {
            echo "Jenkins Job       : ${JOB_NAME}"
            echo "Build Number      : ${BUILD_NUMBER}"
            echo "Branch            : ${env.BRANCH_NAME}"
            echo "Docker Image      : ${IMAGE}:${IMAGE_TAG}"
            echo "Container         : ${CONTAINER}"
            echo "Host Port         : ${HOST_PORT}"
            echo "Container Port    : ${CONTAINER_PORT}"

            node('') {
                cleanWs()
            }
        }
    }
}