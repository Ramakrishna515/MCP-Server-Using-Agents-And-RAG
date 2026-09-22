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

        // Existing container name
        CONTAINER = 'mcp-server'

        // Host port -> Container port
        HOST_PORT = '4001'
        CONTAINER_PORT = '3000'
    }

    stages {

        // ============================================================
        // BUILD & TEST
        // ============================================================

        stage('Build & Test') {

            agent {
                docker {
                    image 'node:22'
                }
            }

            stages {

                // ----------------------------------------------------
                // CHECKOUT
                // ----------------------------------------------------

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

                // ----------------------------------------------------
                // ENVIRONMENT
                // ----------------------------------------------------

                stage('Environment') {
                    steps {
                        sh '''
                            echo "=========================================="
                            echo "ENVIRONMENT"
                            echo "=========================================="

                            echo "NODE_ENV : ${NODE_ENV}"
                            echo "Node     : $(node --version)"
                            echo "NPM      : $(npm --version)"

                            echo "=========================================="
                        '''
                    }
                }

                // ----------------------------------------------------
                // INSTALL DEPENDENCIES
                // ----------------------------------------------------

                stage('Install Dependencies') {
                    steps {
                        sh 'npm ci'
                    }
                }

                // ----------------------------------------------------
                // BUILD
                // ----------------------------------------------------

                stage('Build') {
                    steps {
                        sh 'npm run build'
                    }
                }

                // ----------------------------------------------------
                // TEST
                // ----------------------------------------------------

                stage('Test') {
                    steps {
                        sh 'npm run test'
                    }
                }

                // ----------------------------------------------------
                // MCP SERVER SMOKE TEST
                // ----------------------------------------------------

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
                                echo ""
                                echo "Server logs:"
                                cat server.log

                                kill $SRV 2>/dev/null
                                wait $SRV 2>/dev/null

                                exit 1
                            fi
                        '''
                    }
                }

                // ----------------------------------------------------
                // WEB SMOKE TEST
                // ----------------------------------------------------

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
                                echo ""
                                echo "Web server logs:"
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

        // ============================================================
        // DOCKER IMAGE
        // ============================================================

        stage('Docker Image') {

            agent any

            steps {
                sh '''
                    set -e

                    echo "=========================================="
                    echo "DOCKER IMAGE BUILD"
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

        // ============================================================
        // DEPLOY CONTAINER
        // ============================================================

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

                    echo ""
                    echo "=========================================="
                    echo "CHECKING .env FILE"
                    echo "=========================================="

                    if [ ! -f .env ]; then
                        echo "ERROR: .env file not found!"
                        echo ""
                        echo "The container requires:"
                        echo "    --env-file .env"
                        echo ""
                        echo "Deployment stopped."
                        exit 1
                    fi

                    echo ".env file found."

                    echo ""
                    echo "=========================================="
                    echo "STOPPING EXISTING CONTAINER"
                    echo "=========================================="

                    docker stop ${CONTAINER} 2>/dev/null || true
                    docker rm ${CONTAINER} 2>/dev/null || true

                    echo "Existing container removed."

                    echo ""
                    echo "=========================================="
                    echo "CHECKING HOST PORT"
                    echo "=========================================="

                    EXISTING=$(docker ps -q --filter "publish=${HOST_PORT}")

                    if [ -n "$EXISTING" ]; then

                        echo "Port ${HOST_PORT} is currently used by:"
                        echo "$EXISTING"

                        echo ""
                        echo "Removing containers using port ${HOST_PORT}..."

                        docker rm -f $EXISTING

                    else

                        echo "Port ${HOST_PORT} is free."

                    fi

                    echo ""
                    echo "=========================================="
                    echo "STARTING NEW CONTAINER"
                    echo "=========================================="

                    docker run -d \
                        --name ${CONTAINER} \
                        --restart unless-stopped \
                        -p ${HOST_PORT}:${CONTAINER_PORT} \
                        --env-file .env \
                        ${IMAGE}:${IMAGE_TAG}

                    echo ""
                    echo "Container started successfully."

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
                    echo "=========================================="
                    echo "ENVIRONMENT"
                    echo "=========================================="

                    echo "Environment file : .env"
                    echo "NODE_ENV         : ${NODE_ENV}"

                    echo ""
                    echo "=========================================="
                    echo "APPLICATION URL"
                    echo "=========================================="

                    echo "http://localhost:${HOST_PORT}"

                    echo ""
                    echo "=========================================="
                    echo "DEPLOYMENT COMPLETED"
                    echo "=========================================="
                '''
            }
        }
    }

    // ================================================================
    // POST ACTIONS
    // ================================================================

    post {

        always {
            node('') {
                cleanWs()
            }
        }

        success {
            echo '=========================================='
            echo 'JENKINS DEPLOYMENT SUCCESSFUL'
            echo '=========================================='
        }

        failure {
            echo '=========================================='
            echo 'JENKINS DEPLOYMENT FAILED'
            echo '=========================================='
        }
    }
}